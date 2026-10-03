import { execFile } from "child_process";
import dgram from "dgram";
import os from "os";

const VPN_OR_VIRTUAL_NAME =
  /nord|nordlynx|nordvpn|openvpn|proton|wireguard|wintun|tap-windows|tap0|tun\d|hamachi|tailscale|zerotier|radmin|forticlient|anyconnect|checkpoint|vethernet|hyper-v|wsl|virtualbox|vmware|bluetooth|loopback|docker|vbox/i;

/** Typical VPN tunnel ranges — never advertise these to the phone. */
function isVpnAddress(address: string): boolean {
  if (address.startsWith("10.5.")) return true; // NordLynx
  if (address.startsWith("10.7.")) return true; // Proton
  if (address.startsWith("10.8.")) return true; // OpenVPN
  if (address.startsWith("10.100.")) return true; // Nord OpenVPN
  if (address.startsWith("26.")) return true; // Hamachi
  const parts = address.split(".").map(Number);
  if (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true; // CGNAT / Tailscale
  }
  return false;
}

function isIPv4(iface: os.NetworkInterfaceInfo): boolean {
  return iface.family === "IPv4" || (iface.family as unknown) === 4;
}

export interface LanIface {
  name: string;
  address: string;
  netmask: string;
}

export function listIgnoredVpnAddresses(): { name: string; address: string }[] {
  const ignored: { name: string; address: string }[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (!isIPv4(iface) || iface.internal) continue;
      if (VPN_OR_VIRTUAL_NAME.test(name) || isVpnAddress(iface.address)) {
        ignored.push({ name, address: iface.address });
      }
    }
  }
  return ignored;
}

/** Physical Wi-Fi / Ethernet only — VPN and virtual NICs are skipped. */
export function getLanIfaces(): LanIface[] {
  const interfaces = os.networkInterfaces();
  const result: LanIface[] = [];
  for (const name of Object.keys(interfaces)) {
    if (VPN_OR_VIRTUAL_NAME.test(name)) continue;
    for (const iface of interfaces[name] ?? []) {
      if (!isIPv4(iface) || iface.internal) continue;
      if (isVpnAddress(iface.address)) continue;
      result.push({ name, address: iface.address, netmask: iface.netmask });
    }
  }
  result.sort((a, b) => scoreIface(b) - scoreIface(a));
  return result;
}

function scoreIface(iface: LanIface): number {
  const n = iface.name.toLowerCase();
  if (/wi-?fi|wlan|wireless/i.test(n)) return 3;
  if (/ethernet|local area/i.test(n)) return 2;
  return 1;
}

export function ipv4Broadcast(address: string, netmask: string): string {
  const addr = address.split(".").map(Number);
  const mask = netmask.split(".").map(Number);
  return addr.map((octet, i) => octet | (~mask[i] & 255)).join(".");
}

function execWin(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Allow inbound TCP on the LAN even while a VPN is connected. */
export async function ensureWindowsLanAccess(port: number, programPath?: string): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await execWin("netsh", [
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=Dota Spawn Alarm LAN",
      "dir=in",
      "action=allow",
      "protocol=TCP",
      `localport=${String(port)}`,
      "profile=private,domain",
    ]);
  } catch {
    // Rule already exists, or the process is not elevated.
  }
  if (!programPath) return;
  try {
    await execWin("netsh", [
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=Dota Spawn Alarm Program",
      "dir=in",
      "action=allow",
      "program",
      programPath,
      "enable=yes",
      "profile=private,domain",
    ]);
  } catch {
    // Rule already exists, or the process is not elevated.
  }
}

export async function removeWindowsLanAccess(): Promise<void> {
  if (process.platform !== "win32") return;
  for (const name of [
    "Dota Spawn Alarm LAN",
    "Dota Spawn Alarm Program",
    "Dota2 GSI Relay LAN",
    "Dota2 GSI Relay Program",
  ]) {
    try {
      await execWin("netsh", ["advfirewall", "firewall", "delete", "rule", `name=${name}`]);
    } catch {
      /* rule missing or not elevated */
    }
  }
}

/**
 * Broadcast a LAN-only beacon bound to the Wi-Fi IP so packets leave the
 * physical NIC, not NordLynx / OpenVPN.
 */
export function startLanBeacon(
  lan: LanIface,
  payload: Record<string, unknown>,
  beaconPort: number,
): void {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const body = Buffer.from(JSON.stringify(payload));
  const broadcast = ipv4Broadcast(lan.address, lan.netmask);

  sock.on("error", () => {
    /* adapter disappeared */
  });

  sock.bind(beaconPort, lan.address, () => {
    try {
      sock.setBroadcast(true);
    } catch {
      sock.close();
      return;
    }
    const tick = () => {
      sock.send(body, beaconPort, broadcast, () => undefined);
    };
    tick();
    setInterval(tick, 1500).unref?.();
  });
}
