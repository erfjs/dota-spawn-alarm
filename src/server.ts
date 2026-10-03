import express from "express";
import http from "http";
import path from "path";
import { WebSocket, WebSocketServer } from "ws";
import { GsiPayload, RelayState } from "./types";
import { applyGsiUpdate, asPausedLiveState, idleRelayState, isGsiTick } from "./gsiParser";
import {
  getLanIfaces,
  listIgnoredVpnAddresses,
  startLanBeacon,
} from "./lan";
import { openDashboard, startWindowsTray } from "./tray";
import {
  acquireSingleInstance,
  bootstrapWindows,
  isDota2Running,
  isPackaged,
  isSilent,
  uninstallWindows,
  wantsUninstall,
  writeLog,
} from "./windowsSetup";

const PORT = Number(process.env.PORT ?? 3500);
// Optional shared secret — set the same value in the GSI .cfg file's "token"
// field (via the auth block) if you want to reject spoofed POSTs.
const GSI_AUTH_TOKEN = process.env.GSI_AUTH_TOKEN ?? "";

const BEACON_PORT = Number(process.env.BEACON_PORT ?? 3501);

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));

let lastState: RelayState = idleRelayState();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let gsiPackets = 0;
let gsiLastSeenAt: number | undefined;
let gsiLastError: string | undefined;
let gsiLastKeys: string[] = [];
let dotaRunning = false;
const GSI_IDLE_AFTER_MS = 12_000;
/** Pause stops GSI until heartbeat. Infer only after packets actually stop. */
const GSI_INFER_PAUSE_AFTER_MS = 8_000;
const GSI_LIVE_IDLE_AFTER_MS = 45_000;
const GSI_LINK_AFTER_MS = 20_000;

app.post("/gsi", express.raw({ type: () => true, limit: "2mb" }), (req, res) => {
  const bytes = Buffer.isBuffer(req.body) ? req.body.length : 0;
  const { body, error } = parseGsiBody(req.body);
  if (error) {
    gsiPackets += 1;
    gsiLastSeenAt = Date.now();
    gsiLastError = error;
    writeLog(`GSI JSON parse failed (${bytes}b): ${error}`);
    console.log(`GSI JSON parse failed (${bytes}b): ${error}`);
    publish(lastState);
    res.status(200).end();
    return;
  }

  if (GSI_AUTH_TOKEN && body.auth?.token !== GSI_AUTH_TOKEN) {
    res.status(401).end();
    return;
  }

  gsiPackets += 1;
  gsiLastSeenAt = Date.now();
  gsiLastError = undefined;
  gsiLastKeys = Object.keys(body);
  if (gsiPackets <= 3 || gsiPackets % 50 === 0) {
    const summary = gsiLastKeys.join(",") || "(empty)";
    writeLog(`GSI packet #${gsiPackets} keys=${summary} bytes=${bytes}`);
    console.log(`GSI packet #${gsiPackets} keys=${summary} bytes=${bytes}`);
  }

  if (isGsiTick(body) || Object.keys(body).length) {
    lastState = applyGsiUpdate(body, lastState);
    scheduleIdleClear();
  }
  publish(lastState);
  res.status(200).end();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dota-spawn-alarm",
    port: PORT,
    lan: getLanIfaces().map((iface) => iface.address),
    gsi: lastState.gsi,
    lastKeys: gsiLastKeys,
  });
});

// Handy for debugging without opening a WebSocket client.
app.get("/state", (_req, res) => {
  res.json(lastState);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (socket: WebSocket) => {
  socket.send(JSON.stringify(attachPresence(lastState)));
});

function parseGsiBody(raw: unknown): { body: GsiPayload; error?: string } {
  if (raw == null) return { body: {} };
  if (Buffer.isBuffer(raw) && raw.length === 0) return { body: {} };
  const text = Buffer.isBuffer(raw)
    ? raw.toString("utf8")
    : typeof raw === "string"
      ? raw
      : "";
  if (!text.trim()) {
    if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
      return { body: raw as GsiPayload };
    }
    return { body: {} };
  }
  try {
    return { body: JSON.parse(text) as GsiPayload };
  } catch (err) {
    return { body: {}, error: (err as Error).message };
  }
}

function gsiPresence(): NonNullable<RelayState["gsi"]> {
  return {
    packets: gsiPackets,
    lastSeenAt: gsiLastSeenAt,
    lastError: gsiLastError,
    dotaRunning,
    connected: Boolean(gsiLastSeenAt && Date.now() - gsiLastSeenAt < GSI_LINK_AFTER_MS),
  };
}

function attachPresence(state: RelayState): RelayState {
  return { ...state, gsi: gsiPresence() };
}

function publish(state: RelayState) {
  lastState = attachPresence(state);
  broadcast(lastState);
}

async function refreshPresence() {
  const running = await isDota2Running();
  const next = {
    packets: gsiPackets,
    lastSeenAt: gsiLastSeenAt,
    lastError: gsiLastError,
    dotaRunning: running,
    connected: Boolean(gsiLastSeenAt && Date.now() - gsiLastSeenAt < GSI_LINK_AFTER_MS),
  };
  const prev = lastState.gsi;
  if (
    prev &&
    prev.dotaRunning === next.dotaRunning &&
    prev.connected === next.connected &&
    prev.packets === next.packets &&
    prev.lastError === next.lastError
  ) {
    return;
  }
  dotaRunning = running;
  lastState = attachPresence(lastState);
  broadcast(lastState);
}

function scheduleIdleClear() {
  if (idleTimer) clearTimeout(idleTimer);
  if (lastState.status === "idle") return;

  if (lastState.status === "ended") {
    idleTimer = setTimeout(clearToIdle, GSI_IDLE_AFTER_MS);
    return;
  }

  if (!lastState.match.paused) {
    idleTimer = setTimeout(() => {
      if (lastState.status !== "live" || lastState.match.paused) return;
      if (gsiLastSeenAt && Date.now() - gsiLastSeenAt < GSI_INFER_PAUSE_AFTER_MS) return;
      // Menu / post-match shells go quiet like a pause, but have no match HUD.
      if (!hasLiveMatchContent(lastState)) {
        clearToIdle();
        return;
      }
      publish(asPausedLiveState(lastState));
      scheduleIdleClear();
    }, GSI_INFER_PAUSE_AFTER_MS);
    return;
  }

  idleTimer = setTimeout(clearToIdle, GSI_LIVE_IDLE_AFTER_MS);
}

function hasLiveMatchContent(state: RelayState): boolean {
  const id = state.match.id;
  const hasId = Boolean(id && id !== "0" && id !== "-1");
  return Boolean(state.hero.name || hasId);
}

function clearToIdle() {
  if (lastState.status === "idle") return;
  publish(idleRelayState(Date.now(), "timeout"));
}

function broadcast(state: RelayState) {
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Already running on port ${PORT}.`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

async function main() {
  if (wantsUninstall()) {
    await uninstallWindows();
    process.exit(0);
  }

  if (!acquireSingleInstance()) {
    console.log("Dota Spawn Alarm is already running.");
    process.exit(0);
  }

  await bootstrapWindows(PORT);

  server.listen(PORT, "0.0.0.0", () => {
    const lan = getLanIfaces();
    const vpn = listIgnoredVpnAddresses();

    for (const iface of lan) {
      startLanBeacon(
        iface,
        {
          v: 1,
          service: "dota-spawn-alarm",
          name: "Gaming PC",
          host: iface.address,
          port: PORT,
        },
        BEACON_PORT,
      );
    }

    console.log(`Dota Spawn Alarm running on port ${PORT}`);
    console.log(`  Game -> POST to  http://127.0.0.1:${PORT}/gsi`);
    if (lan.length) {
      for (const iface of lan) {
        console.log(`  Phone (Wi-Fi only) -> ws://${iface.address}:${PORT}  [${iface.name}]`);
      }
    } else {
      console.log(`  Phone/browser -> ws://<this-pc-wifi-ip>:${PORT}`);
    }
    console.log(`  Companion HUD -> http://127.0.0.1:${PORT}/`);
    console.log("  Keep the Chrome tab open for match alerts without the phone app.");
    openDashboard(PORT);
    if (vpn.length) {
      console.log("  VPN adapters ignored (phone will not use these):");
      for (const item of vpn) {
        console.log(`    ${item.address}  [${item.name}]`);
      }
      console.log("  If the phone stays Unreachable: NordVPN → Invisibility on LAN = OFF");
    }

    startWindowsTray({
      port: PORT,
      hideConsole: isPackaged() || isSilent(),
      onExit: () => process.exit(0),
      onUninstall: () => {
        void uninstallWindows().finally(() => process.exit(0));
      },
    });

    void refreshPresence();
    setInterval(() => {
      void refreshPresence();
    }, 2000);
  });
}

void main();
