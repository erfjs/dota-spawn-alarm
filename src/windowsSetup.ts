import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureWindowsLanAccess, removeWindowsLanAccess } from "./lan";

const APP_FOLDER = "DotaSpawnAlarm";
const EXE_NAME = "DotaSpawnAlarm.exe";
const RUN_VALUE = "Dota Spawn Alarm";
const GSI_CFG_NAME = "gamestate_integration_spawn_alarm.cfg";
const UNINSTALL_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DotaSpawnAlarm";
const APP_VERSION = "1.0.0";

const GSI_CFG_CONTENTS = `"Dota Spawn Alarm"
{
    "uri"           "http://127.0.0.1:3500/gsi"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "5.0"
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "player"        "1"
        "hero"          "1"
        "abilities"     "0"
        "items"         "1"
    }
    "output"
    {
        "precision_time" "3"
    }
}
`;

export function isPackaged(): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
}

export function isSilent(): boolean {
  return process.argv.includes("--silent");
}

export function wantsUninstall(): boolean {
  return process.argv.some((arg) => arg === "--uninstall" || arg === "/uninstall");
}

export function installDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, APP_FOLDER);
}

function legacyInstallDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "Dota2GsiRelay");
}

function execCapture(file: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 12_000, encoding: "utf8" }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout ?? "") });
    });
  });
}

async function steamInstallPaths(): Promise<string[]> {
  const queries: Array<[string, string]> = [
    ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
    ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"],
  ];
  const found = new Set<string>();
  for (const [key, value] of queries) {
    const { ok, stdout } = await execCapture("reg", ["query", key, "/v", value]);
    if (!ok) continue;
    const match = stdout.match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, "i"));
    if (match?.[1]) {
      found.add(path.normalize(match[1].trim().replace(/\//g, "\\")));
    }
  }
  for (const fallback of ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]) {
    if (fs.existsSync(fallback)) found.add(fallback);
  }
  return [...found];
}

function parseSteamLibraries(steamRoot: string): string[] {
  const libraries = [steamRoot];
  const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
  try {
    const text = fs.readFileSync(vdfPath, "utf8");
    const re = /"path"\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      libraries.push(path.normalize(match[1].replace(/\\\\/g, "\\")));
    }
  } catch {
    /* no extra libraries */
  }
  return [...new Set(libraries)];
}

function dotaGsiDir(libraryRoot: string): string | null {
  const gameDir = path.join(
    libraryRoot,
    "steamapps",
    "common",
    "dota 2 beta",
    "game",
    "dota",
  );
  if (!fs.existsSync(gameDir)) return null;
  return path.join(gameDir, "cfg", "gamestate_integration");
}

function installGsiConfig(steamRoots: string[]): string[] {
  const installed: string[] = [];
  const seen = new Set<string>();
  for (const root of steamRoots) {
    for (const library of parseSteamLibraries(root)) {
      const dir = dotaGsiDir(library);
      if (!dir) continue;
      const dest = path.join(dir, GSI_CFG_NAME);
      const key = dest.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, GSI_CFG_CONTENTS, "utf8");
      installed.push(dest);
    }
  }
  return installed;
}

function removeGsiConfigs(steamRoots: string[]): void {
  const names = [GSI_CFG_NAME, "gamestate_integration_relay.cfg"];
  for (const root of steamRoots) {
    for (const library of parseSteamLibraries(root)) {
      const dir = dotaGsiDir(library);
      if (!dir) continue;
      for (const name of names) {
        const dest = path.join(dir, name);
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function samePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

function resolvePublicIcon(...names: string[]): string | null {
  const roots = [
    path.join(__dirname, "..", "public"),
    path.join(path.dirname(process.execPath), "public"),
    path.join(process.cwd(), "public"),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* pkg snapshot quirks */
      }
    }
  }
  return null;
}

function persistAppIcons(): string | null {
  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  const sourceIco = resolvePublicIcon("icon.ico", "icon-tray.ico");
  const sourcePng = resolvePublicIcon("icon-tray.png", "icon-tray-32.png", "icon.png");
  let icoDest: string | null = null;
  if (sourceIco) {
    icoDest = path.join(dir, "icon.ico");
    try {
      fs.copyFileSync(sourceIco, icoDest);
    } catch {
      icoDest = null;
    }
  }
  if (sourcePng) {
    try {
      fs.copyFileSync(sourcePng, path.join(dir, "icon-tray.png"));
    } catch {
      /* ignore */
    }
  }
  return icoDest;
}

function createDesktopShortcut(exePath: string, iconPath: string | null, launcherPath?: string): void {
  const desktop =
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : "";
  if (!desktop || !fs.existsSync(desktop)) return;
  const lnkPath = path.join(desktop, "Dota Spawn Alarm.lnk");
  const icon = iconPath && fs.existsSync(iconPath) ? iconPath : exePath;
  // Prefer the hidden VBS launcher so a console window never flashes.
  const target = launcherPath && fs.existsSync(launcherPath) ? launcherPath : exePath;
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$sc = $ws.CreateShortcut('${lnkPath.replace(/'/g, "''")}')`,
    `$sc.TargetPath = '${target.replace(/'/g, "''")}'`,
    `$sc.WorkingDirectory = '${path.dirname(exePath).replace(/'/g, "''")}'`,
    `$sc.IconLocation = '${icon.replace(/'/g, "''")},0'`,
    "$sc.WindowStyle = 7",
    "$sc.Description = 'Dota Spawn Alarm'",
    "$sc.Save()",
  ].join("; ");
  try {
    spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true, stdio: "ignore", detached: true },
    ).unref();
  } catch {
    /* ignore */
  }
}

function persistExe(): string {
  const dest = path.join(installDir(), EXE_NAME);
  fs.mkdirSync(installDir(), { recursive: true });
  if (!isPackaged()) return process.execPath;
  if (samePath(process.execPath, dest)) return dest;
  try {
    fs.copyFileSync(process.execPath, dest);
  } catch (err) {
    console.log(`Could not copy EXE to ${dest}: ${(err as Error).message}`);
    return process.execPath;
  }
  return dest;
}

function writeHiddenLauncher(exePath: string): string {
  const vbsPath = path.join(installDir(), "start-hidden.vbs");
  const escaped = exePath.replace(/"/g, '""');
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run """${escaped}"" --silent", 0, False`,
    "",
  ].join("\r\n");
  fs.writeFileSync(vbsPath, vbs, "utf8");
  return vbsPath;
}

async function registerStartup(vbsPath: string): Promise<void> {
  // Remove legacy auto-start entries from the previous product name.
  await execCapture("reg", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    "Dota2 GSI Relay",
    "/f",
  ]);
  await execCapture("reg", [
    "add",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    RUN_VALUE,
    "/t",
    "REG_SZ",
    "/d",
    `wscript.exe "${vbsPath}"`,
    "/f",
  ]);
}

async function registerUninstallEntry(exePath: string): Promise<void> {
  const icoPath = path.join(installDir(), "icon.ico");
  const pngPath = path.join(installDir(), "icon-tray.png");
  const displayIcon = fs.existsSync(icoPath) ? icoPath : fs.existsSync(pngPath) ? pngPath : exePath;
  const uninstallCmd = `"${exePath}" --uninstall`;
  const estimatedKb = Math.max(1, Math.round(fs.statSync(exePath).size / 1024));

  const values: Array<[string, string, string]> = [
    ["DisplayName", "REG_SZ", "Dota Spawn Alarm"],
    ["DisplayVersion", "REG_SZ", APP_VERSION],
    ["Publisher", "REG_SZ", "Dota Spawn Alarm"],
    ["InstallLocation", "REG_SZ", installDir()],
    ["DisplayIcon", "REG_SZ", displayIcon],
    ["UninstallString", "REG_SZ", uninstallCmd],
    ["QuietUninstallString", "REG_SZ", uninstallCmd],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
    ["EstimatedSize", "REG_DWORD", String(estimatedKb)],
  ];

  for (const [name, type, data] of values) {
    await execCapture("reg", ["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", data, "/f"]);
  }
}

function killPidIfRunning(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, 0);
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
  } catch {
    /* not running */
  }
}

function stopOtherInstanceFromLock(dir: string): void {
  const lockPath = path.join(dir, "relay.lock");
  try {
    if (!fs.existsSync(lockPath)) return;
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    killPidIfRunning(pid);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

function scheduleFolderDelete(dir: string): void {
  if (!fs.existsSync(dir)) return;
  // Delay so this process (and its tray child) can exit before files are removed.
  const quoted = dir.replace(/"/g, "");
  const cmd = `ping 127.0.0.1 -n 3 >nul & rmdir /s /q "${quoted}"`;
  spawn("cmd.exe", ["/c", cmd], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  }).unref();
}

export async function uninstallWindows(): Promise<void> {
  if (process.platform !== "win32") return;

  stopOtherInstanceFromLock(installDir());
  stopOtherInstanceFromLock(legacyInstallDir());

  await execCapture("reg", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    RUN_VALUE,
    "/f",
  ]);
  await execCapture("reg", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    "Dota2 GSI Relay",
    "/f",
  ]);
  await execCapture("reg", ["delete", UNINSTALL_KEY, "/f"]);

  const steamRoots = await steamInstallPaths();
  removeGsiConfigs(steamRoots);
  await removeWindowsLanAccess();

  scheduleFolderDelete(installDir());
  scheduleFolderDelete(legacyInstallDir());

  console.log("Dota Spawn Alarm uninstalled.");
  writeLog("Uninstall requested");
}

export async function isDota2Running(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const { ok, stdout } = await execCapture("tasklist", [
    "/FI",
    "IMAGENAME eq dota2.exe",
    "/NH",
  ]);
  return ok && /dota2\.exe/i.test(stdout);
}

export function writeLog(line: string): void {
  try {
    fs.mkdirSync(installDir(), { recursive: true });
    fs.appendFileSync(
      path.join(installDir(), "relay.log"),
      `[${new Date().toISOString()}] ${line}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

export function acquireSingleInstance(): boolean {
  if (process.platform !== "win32") return true;
  const lockPath = path.join(installDir(), "relay.lock");
  fs.mkdirSync(installDir(), { recursive: true });
  const tryCreate = (): boolean => {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      const release = () => {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      };
      process.on("exit", release);
      process.on("SIGINT", () => {
        release();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        release();
        process.exit(0);
      });
      return true;
    } catch {
      return false;
    }
  };

  if (tryCreate()) return true;

  try {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        fs.unlinkSync(lockPath);
      }
    } else {
      fs.unlinkSync(lockPath);
    }
  } catch {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
  return tryCreate();
}

export async function bootstrapWindows(port: number): Promise<void> {
  if (process.platform !== "win32") return;

  const steamRoots = await steamInstallPaths();
  const gsiPaths = installGsiConfig(steamRoots);
  if (gsiPaths.length) {
    for (const dest of gsiPaths) {
      console.log(`GSI config installed -> ${dest}`);
      writeLog(`GSI config installed: ${dest}`);
    }
    console.log("If Dota 2 is already open, restart it once so the config loads.");
  } else {
    console.log("Dota 2 folder not found — GSI config was not installed.");
    writeLog("Dota 2 folder not found");
  }

  if (isPackaged()) {
    const exePath = persistExe();
    const iconPath = persistAppIcons();
    const vbsPath = writeHiddenLauncher(exePath);
    createDesktopShortcut(exePath, iconPath, vbsPath);
    await registerStartup(vbsPath);
    await registerUninstallEntry(exePath);
    console.log(`Installed to ${path.dirname(exePath)}`);
    console.log("Will start automatically with Windows.");
    console.log("Desktop shortcut uses the app notification icon.");
    console.log("Uninstall from Windows Settings → Apps, or run with --uninstall.");
    writeLog(`Installed EXE: ${exePath}`);
    await ensureWindowsLanAccess(port, exePath);
  } else {
    await ensureWindowsLanAccess(port);
  }
}
