import { execFile, spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { installDir } from "./windowsSetup";
import { TRAY_ICON_PNG_BASE64 } from "./trayIconData";

const TRAY_SCRIPT = `param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][int]$HideConsole,
  [Parameter(Mandatory = $false)][string]$IconPath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TrayNative {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool DestroyIcon(IntPtr hIcon);
}
"@

function Hide-ParentWindow {
  $proc = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [TrayNative]::ShowWindow($proc.MainWindowHandle, 0) | Out-Null
  }
}

if ($HideConsole -eq 1) { Hide-ParentWindow }

function New-TrayIconFromPath([string]$path) {
  if (-not $path) { return $null }
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq ".ico") {
    return New-Object System.Drawing.Icon $path, 32, 32
  }
  $bmp = [System.Drawing.Bitmap]::FromFile($path)
  try {
    $h = $bmp.GetHicon()
    $tmp = [System.Drawing.Icon]::FromHandle($h)
    $clone = [System.Drawing.Icon]$tmp.Clone()
    [void][TrayNative]::DestroyIcon($h)
    $tmp.Dispose()
    return $clone
  } finally {
    $bmp.Dispose()
  }
}

function New-FallbackTrayIcon {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $orange = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 90, 26))
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 28, 18, 12))
  $g.FillEllipse($orange, 1, 1, 30, 30)
  $g.FillEllipse($dark, 5, 5, 22, 22)
  $g.FillEllipse($orange, 12, 8, 8, 8)
  $g.Dispose()
  $h = $bmp.GetHicon()
  $tmp = [System.Drawing.Icon]::FromHandle($h)
  $clone = [System.Drawing.Icon]$tmp.Clone()
  [void][TrayNative]::DestroyIcon($h)
  $tmp.Dispose()
  $bmp.Dispose()
  $orange.Dispose()
  $dark.Dispose()
  return $clone
}

$ownedIcon = $null
try {
  $ownedIcon = New-TrayIconFromPath $IconPath
} catch {
  $ownedIcon = $null
}
if (-not $ownedIcon) {
  $ownedIcon = New-FallbackTrayIcon
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $ownedIcon
$notify.Text = "Dota Spawn Alarm"
$notify.Visible = $true

function Send-Cmd([string]$cmd) {
  [Console]::Out.WriteLine($cmd)
  [Console]::Out.Flush()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = New-Object System.Windows.Forms.ToolStripMenuItem "Open dashboard"
$open.Add_Click({ Send-Cmd "OPEN" })
$uninstall = New-Object System.Windows.Forms.ToolStripMenuItem "Uninstall"
$uninstall.Add_Click({
  $msg = "Remove Dota Spawn Alarm from this PC?" + [Environment]::NewLine + "Startup, GSI config, and app files will be deleted."
  $answer = [System.Windows.Forms.MessageBox]::Show(
    $msg,
    "Uninstall Dota Spawn Alarm",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
    Send-Cmd "UNINSTALL"
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})
$exit = New-Object System.Windows.Forms.ToolStripMenuItem "Exit"
$exit.Add_Click({
  Send-Cmd "EXIT"
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($open)
[void]$menu.Items.Add($uninstall)
[void]$menu.Items.Add($exit)
$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Send-Cmd "OPEN" })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
    return
  }
  if ($HideConsole -eq 1) { Hide-ParentWindow }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$timer.Stop()
$notify.Visible = $false
$notify.Dispose()
if ($ownedIcon) { $ownedIcon.Dispose() }
`;

function chromePath(): string | null {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function resolveBundledIcon(): string | null {
  const names = ["icon-tray.png", "icon-tray-32.png", "icon-tray.ico", "icon.ico"];
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

/** Always materialize a real on-disk PNG for the PowerShell tray host. */
function ensureTrayIconOnDisk(): string {
  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  const destPng = path.join(dir, "icon-tray.png");
  const source = resolveBundledIcon();
  if (source) {
    try {
      const dest =
        source.toLowerCase().endsWith(".ico") ? path.join(dir, "icon-tray.ico") : destPng;
      fs.copyFileSync(source, dest);
      return dest;
    } catch {
      /* fall through to embedded */
    }
  }
  fs.writeFileSync(destPng, Buffer.from(TRAY_ICON_PNG_BASE64, "base64"));
  return destPng;
}

/** Phone-sized Chrome app window (companion HUD). */
const DASHBOARD_W = 420;
const DASHBOARD_H = 820;

/** Chrome often restores the last --app bounds and ignores --window-size; force via Win32. */
function forceDashboardWindowSize(): void {
  if (process.platform !== "win32") return;
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class HudWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool repaint);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static List<IntPtr> Find(string title) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, sb.Capacity);
      if (sb.ToString() == title) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
$w = ${DASHBOARD_W}; $h = ${DASHBOARD_H}
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $handles = [HudWin]::Find("Dota Spawn Alarm")
  if ($handles.Count -gt 0) {
    foreach ($hwnd in $handles) {
      $r = New-Object HudWin+RECT
      [void][HudWin]::GetWindowRect($hwnd, [ref]$r)
      [void][HudWin]::MoveWindow($hwnd, $r.Left, $r.Top, $w, $h, $true)
    }
    break
  }
  Start-Sleep -Milliseconds 250
}
`.trim();
  spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, detached: true, stdio: "ignore" },
  ).unref();
}

export function openDashboard(port: number): void {
  const url = `http://127.0.0.1:${port}/`;
  const chrome = chromePath();
  if (chrome) {
    // Use the default Chrome profile — a dedicated --user-data-dir can spawn
    // chrome.exe with no visible --app window on Windows.
    execFile(
      chrome,
      [`--app=${url}`, `--window-size=${DASHBOARD_W},${DASHBOARD_H}`],
      { windowsHide: true },
    );
    forceDashboardWindowSize();
    return;
  }
  execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true });
  forceDashboardWindowSize();
}

export function startWindowsTray(opts: {
  port: number;
  hideConsole: boolean;
  onExit: () => void;
  onUninstall?: () => void;
}): ChildProcess | null {
  if (process.platform !== "win32") return null;

  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, "tray.ps1");
  fs.writeFileSync(scriptPath, TRAY_SCRIPT.replace(/\n/g, "\r\n"), "utf8");
  const iconPath = ensureTrayIconOnDisk();

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      scriptPath,
      "-ParentPid",
      String(process.pid),
      "-Port",
      String(opts.port),
      "-HideConsole",
      opts.hideConsole ? "1" : "0",
      "-IconPath",
      iconPath,
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stderr?.on("data", (chunk: Buffer) => {
    try {
      fs.appendFileSync(path.join(dir, "tray-error.log"), chunk.toString("utf8"), "utf8");
    } catch {
      /* ignore */
    }
  });

  const onLine = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      const cmd = line.trim();
      if (cmd === "OPEN") openDashboard(opts.port);
      if (cmd === "EXIT") opts.onExit();
      if (cmd === "UNINSTALL") opts.onUninstall?.();
    }
  };
  child.stdout?.on("data", onLine);

  const stop = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  return child;
}
