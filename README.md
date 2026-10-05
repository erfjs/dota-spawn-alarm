# Dota Spawn Alarm

**Live spawn timers and match HUD for Dota 2** — powered by Valve’s official [Game State Integration (GSI)](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration).

Run a small local app on your Windows PC. Dota 2 streams match state to it. A companion dashboard (Chrome or phone browser) shows spawn countdowns, plays alerts, and mirrors your live HUD — fully offline, no account, no cloud.

---

## Features

| Area | What you get |
|------|----------------|
| **Spawn timers** | Power runes, wisdom runes, lotus pools, tormentor, and camp stack windows — synced to the live game clock |
| **Chrome alerts** | Desktop notifications + sounds for upcoming spawns (keep the dashboard tab open; phone optional) |
| **Match HUD** | Score, clock, hero, HP/mana, gold, GPM/XPM, K/D/A, last hits/denies, inventory |
| **Phone companion** | Open the same HUD on any phone on your Wi‑Fi — no app store install |
| **Zero setup GSI** | Packaged EXE finds Steam/Dota and installs the GSI config for you |
| **Tray + autostart** | Runs quietly in the system tray; starts with Windows |
| **LAN-aware** | Advertises over local Wi‑Fi/Ethernet; ignores VPN adapters so your phone gets the right IP |
| **Privacy-first** | All data stays on your machine — nothing is sent to the internet |

---

## Download (Windows)

1. Open the latest **[GitHub Release](https://github.com/erfjs/dota-spawn-alarm/releases/latest)**
2. Download `DotaSpawnAlarm.exe`
3. Run it (Windows SmartScreen may warn on unsigned apps — choose **More info → Run anyway**)
4. On first launch the app will:
   - Install itself under `%LOCALAPPDATA%\DotaSpawnAlarm\`
   - Write the Dota GSI config into your Dota 2 folder
   - Create a desktop shortcut
   - Register Windows startup + an uninstall entry
   - Open the companion dashboard in your browser
5. **Restart Dota 2 once** if it was already running, then join a match (or demo)

Uninstall from **Windows Settings → Apps**, from the tray menu, or by running:

```text
DotaSpawnAlarm.exe --uninstall
```

> Download counts on GitHub Releases are a good proxy for how many people picked up the app.

---

## How it works

```text
┌─────────────┐   POST /gsi    ┌──────────────────┐   WebSocket    ┌────────────────────┐
│   Dota 2    │ ─────────────► │ Dota Spawn Alarm │ ─────────────► │ Browser / phone HUD │
│  (GSI cfg)  │  127.0.0.1     │  (local server)  │   LAN or local │  timers + alerts    │
└─────────────┘                └──────────────────┘                └────────────────────┘
```

1. Dota 2 posts JSON game state to `http://127.0.0.1:3500/gsi`
2. The relay trims that payload into a compact `RelayState`
3. Connected dashboards receive live updates over WebSocket
4. Timers and alerts are computed in the browser from the match clock

Default ports:

| Port | Purpose |
|------|---------|
| `3500` | HTTP + WebSocket (dashboard, `/gsi`, `/health`, `/state`) |
| `3501` | UDP LAN beacon (phone discovery helper) |

Override with environment variables `PORT` and `BEACON_PORT`.

---

## Companion dashboard

Open after the relay starts:

```text
http://127.0.0.1:3500/
```

On another device on the same Wi‑Fi:

```text
http://<your-pc-lan-ip>:3500/
```

The PC console / tray log prints the detected LAN address(es).

### Alerts you can configure

For each objective, set how many seconds **before** spawn you want a warning (`0` = off):

- Power Rune (first at 6:00, then every 2 min)
- Wisdom Rune (first at 7:00, then every 7 min)
- Lotus Pool (first at 3:00, then every 3 min)
- Tormentor (first at 20:00, respawn ~10 min; side-aware)
- Camp stack window

Also supported: mute, sound on warn / on spawn, and custom sound files.

Chrome notifications require allowing notifications for the dashboard page once.

---

## Develop from source

### Requirements

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- Windows recommended for full tray / install / GSI auto-setup behavior
- Dota 2 installed via Steam

### Install & run

```bash
git clone https://github.com/erfjs/dota-spawn-alarm.git
cd dota-spawn-alarm
npm install
npm run dev
```

Or build then run the compiled output:

```bash
npm run build
npm start
```

### Manual GSI config (dev / non-packaged)

When you are **not** running the packaged EXE, either let `bootstrapWindows` install the config on start, or copy it yourself:

```text
gamestate_integration_spawn_alarm.cfg
  →  <SteamLibrary>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```

Create the `gamestate_integration` folder if it does not exist, then restart Dota 2.

A ready-made copy lives at the repo root: [`gamestate_integration_spawn_alarm.cfg`](./gamestate_integration_spawn_alarm.cfg).

### Build the Windows EXE

```bash
npm run pkg:win
```

Output:

```text
dist-bin/DotaSpawnAlarm.exe
```

(`public/` assets are embedded via `pkg` — you do not need to ship a separate `public` folder next to the EXE.)

Upload that file to a **GitHub Release** so users can download it without installing Node.

### Useful npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run with `ts-node` |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled `dist/server.js` |
| `npm run pkg:win` | Build + package Windows x64 EXE + set icon |
| `npm run pkg:win:safe` | Package EXE without the icon post-step |

---

## Project structure

```text
├── src/
│   ├── server.ts          Express + WebSocket relay
│   ├── gsiParser.ts       Raw GSI → RelayState
│   ├── types.ts           Payload / state TypeScript types
│   ├── windowsSetup.ts    Install, GSI cfg, startup, uninstall
│   ├── tray.ts            Windows system tray
│   └── lan.ts             LAN ifaces, VPN filter, UDP beacon
├── public/
│   ├── index.html         Companion HUD shell
│   ├── companion.js       Timers, alerts, sounds, live UI
│   ├── dashboard.css
│   ├── sw.js              Service worker (PWA helpers)
│   └── manifest.json
├── scripts/
│   └── set-exe-icon.js    Post-process EXE icon
├── gamestate_integration_spawn_alarm.cfg
├── package.json
└── tsconfig.json
```

---

## HTTP / WebSocket API

Useful if you build your own client:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/gsi` | Dota 2 Game State Integration endpoint |
| `GET` | `/` | Companion dashboard |
| `GET` | `/health` | Liveness + LAN addresses + GSI presence |
| `GET` | `/state` | Latest `RelayState` as JSON |
| `WS` | `/` (same port) | Live `RelayState` stream |

See [`src/types.ts`](./src/types.ts) for the `RelayState` shape.

Optional GSI auth (rejects spoofed POSTs only):

```bash
set GSI_AUTH_TOKEN=your-secret
npm start
```

Add a matching block to the GSI `.cfg`:

```text
"auth"
{
    "token" "your-secret"
}
```

---

## Troubleshooting

**Dashboard stuck on “Connecting / Syncing”**
- Confirm the relay is running (tray icon or `http://127.0.0.1:3500/health`)
- Restart Dota 2 after the GSI config was installed
- Join an actual match or demo — the menu alone may not send useful GSI data

**Phone cannot reach the PC**
- Phone and PC must be on the **same Wi‑Fi** (not cellular, not guest isolation)
- Use the Wi‑Fi/Ethernet IP printed by the app — not a VPN IP
- If you use NordVPN: turn **Invisibility on LAN** off
- Allow the app through Windows Firewall when prompted (packaged installs request LAN access)

**Windows SmartScreen / antivirus**
- Unsigned community EXEs often trigger a first-run warning. Prefer downloading only from this repo’s Releases page. Building from source is always an option.

**Port already in use**
- Something else is bound to `3500`, or another instance is running. Close the tray app or set `PORT` to another value (and update the GSI `uri` accordingly).

**Logs**
- Packaged installs write to `%LOCALAPPDATA%\DotaSpawnAlarm\relay.log`

---

## Privacy

Dota Spawn Alarm is designed to work **offline**:

- Match data never leaves your PC except to devices you open the dashboard on (your browser / phone on LAN)
- No analytics, accounts, or telemetry are included
- GSI only exposes the fields enabled in the config (`provider`, `map`, `player`, `hero`, `items`)

---

## Contributing

Issues and pull requests are welcome.

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-change`)
3. Make your change and test with a live match or demo
4. Open a PR with a short description of *why* the change helps

Please keep the app local-first: avoid adding required cloud services.

---

## Disclaimer

This project is **not affiliated with Valve Corporation or Dota 2**.  
Dota 2 is a trademark of Valve Corporation. Use at your own risk. Respect Valve’s terms of service and local laws.

Game State Integration is an official Valve interface; this tool only consumes the data Dota already exposes locally.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Erfan Gr

---

## Roadmap ideas

- Signed Windows releases (fewer SmartScreen warnings)
- Optional anonymous update-check against GitHub Releases
- Extra timer packs / patch-aware schedule updates
- Hardened optional auth for WebSocket clients on shared networks
