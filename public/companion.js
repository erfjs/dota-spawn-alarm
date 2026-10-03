(() => {
  const WARN_MIN = 0;
  const WARN_MAX = 90;
  const WARN_STEP = 5;
  const POWER_RUNE_FIRST = 6 * 60;
  const POWER_RUNE_INTERVAL = 2 * 60;
  const WISDOM_RUNE_FIRST = 7 * 60;
  const WISDOM_RUNE_INTERVAL = 7 * 60;
  const LOTUS_FIRST = 3 * 60;
  const LOTUS_INTERVAL = 3 * 60;
  const TORMENTOR_FIRST = 20 * 60;
  const TORMENTOR_RESPAWN = 10 * 60;
  const DAY_NIGHT_INTERVAL = 5 * 60;
  const CAMP_FIRST_SPAWN = 1 * 60;
  const STACK_WINDOW_START = 53;
  const STACK_WINDOW_END = 55;
  const STACK_FIRST_WINDOW = CAMP_FIRST_SPAWN + STACK_WINDOW_START;
  const WARN_KEY = "dota-spawn-alarm-timer-warnings-v1";
  const SETTINGS_KEY = "dota-spawn-alarm-app-settings";
  const SOUND_DB = "dota-spawn-alarm-sounds";
  const SOUND_STORE = "files";
  const SOUND_MAX_BYTES = 2 * 1024 * 1024;
  const DEFAULT_WARN = { powerRune: 0, wisdomRune: 0, lotus: 0, tormentor: 0, stack: 0 };
  const DEFAULT_SETTINGS = { muted: false, soundOnWarn: false, soundOnSpawn: true, soundNames: {} };
  const SOUND_SLOTS = [
    { id: "powerRune", label: "Power Rune", file: "/sounds/power-rune.wav", builtIn: "Built-in: bright chime" },
    { id: "wisdomRune", label: "Wisdom Rune", file: "/sounds/wisdom-rune.wav", builtIn: "Built-in: soft chime" },
    { id: "lotus", label: "Lotus Pool", file: "/sounds/lotus.wav", builtIn: "Built-in: crystal bell" },
    { id: "tormentor", label: "Tormentor", file: "/sounds/tormentor.wav", builtIn: "Built-in: deep alert" },
    { id: "stack", label: "Camp Stack", file: "/sounds/stack.wav", builtIn: "Built-in: quick ping" },
    { id: "death", label: "Death", file: "/sounds/death.wav", builtIn: "Built-in: low tone" },
    { id: "match", label: "Match start / end", file: "/sounds/match.wav", builtIn: "Built-in: fanfare" },
  ];
  const SOUND_BY_ID = Object.fromEntries(SOUND_SLOTS.map((slot) => [slot.id, slot]));

  const $ = (id) => document.getElementById(id);
  const els = {
    gsiBadge: $("gsiBadge"),
    statusDot: $("statusDot"),
    latency: $("latency"),
    muteBtn: $("muteBtn"),
    settingsBtn: $("settingsBtn"),
    settingsClose: $("settingsClose"),
    settings: $("settings"),
    notifyBanner: $("notifyBanner"),
    notifyTitle: $("notifyTitle"),
    notifyHint: $("notifyHint"),
    notifyBtn: $("notifyBtn"),
    waiting: $("waiting"),
    waitingIcon: $("waitingIcon"),
    waitingTitle: $("waitingTitle"),
    waitingDetail: $("waitingDetail"),
    stepRelay: $("stepRelay"),
    stepDota: $("stepDota"),
    stepMatch: $("stepMatch"),
    live: $("live"),
    pauseBanner: $("pauseBanner"),
    endedBanner: $("endedBanner"),
    winnerLabel: $("winnerLabel"),
    alerts: $("alerts"),
    radiantScore: $("radiantScore"),
    direScore: $("direScore"),
    clockLabel: $("clockLabel"),
    clockValue: $("clockValue"),
    timerClock: $("timerClock"),
    heroImg: $("heroImg"),
    heroLvl: $("heroLvl"),
    heroName: $("heroName"),
    heroTeam: $("heroTeam"),
    liveTag: $("liveTag"),
    gpm: $("gpm"),
    xpm: $("xpm"),
    goldAmt: $("goldAmt"),
    alivePill: $("alivePill"),
    kills: $("kills"),
    deaths: $("deaths"),
    assists: $("assists"),
    impactN: $("impactN"),
    impactS: $("impactS"),
    lastHits: $("lastHits"),
    denies: $("denies"),
    farmRate: $("farmRate"),
    hpLabel: $("hpLabel"),
    hpPct: $("hpPct"),
    hpSeg: $("hpSeg"),
    mpLabel: $("mpLabel"),
    mpPct: $("mpPct"),
    mpFill: $("mpFill"),
    invTop: $("invTop"),
    invBottom: $("invBottom"),
    invSide: $("invSide"),
    backpack: $("backpack"),
    timerCards: $("timerCards"),
    tabMatch: $("tabMatch"),
    tabTimers: $("tabTimers"),
    timerBadge: $("timerBadge"),
    paneMatch: $("paneMatch"),
    paneTimers: $("paneTimers"),
    setMuted: $("setMuted"),
    setWarnSound: $("setWarnSound"),
    setSpawnSound: $("setSpawnSound"),
    resetWarn: $("resetWarn"),
    soundSlots: $("soundSlots"),
  };

  let warnSeconds = loadJson(WARN_KEY, DEFAULT_WARN);
  const savedSettings = loadJson(SETTINGS_KEY, {});
  let settings = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    soundNames: { ...DEFAULT_SETTINGS.soundNames, ...(savedSettings.soundNames || {}) },
  };
  let state = null;
  let wsStatus = "connecting";
  let latencyMs = null;
  let lastPingAt = 0;
  let claimedAt = null;
  let matchId = null;
  let tab = "match";
  let notifyIcon = null;
  let swReg = null;
  const soundUrls = Object.create(null);
  let activeSound = null;
  const seenAlerts = new Set();
  let prevAlive = undefined;
  let prevStatus = undefined;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clampWarn(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(WARN_MAX, Math.max(WARN_MIN, Math.round(value)));
  }

  function normalizeDigits(text) {
    return String(text)
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  }

  function parseWarnInput(raw) {
    let text = normalizeDigits(raw ?? "").trim().toLowerCase();
    text = text.replace(/\b(seconds?|secs?|s)\b/g, " ").trim();
    const match = text.match(/-?\d+/);
    if (!match) return 0;
    return clampWarn(Number.parseInt(match[0], 10));
  }

  function applyWarnSeconds(id, value) {
    const next = clampWarn(value);
    if ((warnSeconds[id] ?? 0) === next) return false;
    warnSeconds[id] = next;
    persistSettings();
    return true;
  }

  function formatClock(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "--:--";
    const neg = seconds < 0;
    const abs = Math.abs(Math.floor(seconds));
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${neg ? "-" : ""}${m}:${s.toString().padStart(2, "0")}`;
  }

  function formatCountdown(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "--:--";
    const abs = Math.max(0, Math.floor(seconds));
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  function formatHeroName(raw) {
    if (!raw) return "UNKNOWN HERO";
    return raw.replace(/^npc_dota_hero_/, "").replace(/_/g, " ").toUpperCase();
  }

  function formatNumber(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function heroImageUrl(raw) {
    if (!raw) return null;
    const key = raw.replace(/^npc_dota_hero_/, "").trim();
    return key ? `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${key}.png` : null;
  }

  function itemImageUrl(raw) {
    if (!raw) return null;
    const key = raw.replace(/^item_/, "").trim();
    return key ? `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/${key}_lg.png` : null;
  }

  function kdaRatio(kills = 0, deaths = 0, assists = 0) {
    return (kills + assists) / Math.max(deaths, 1);
  }

  function dayNightFromClock(clockTime) {
    if (clockTime == null || clockTime < 0) return "day";
    return Math.floor(clockTime / 300) % 2 === 0 ? "day" : "night";
  }

  function farmPerMinute(lastHits, gameTime) {
    if (lastHits == null || !gameTime || gameTime <= 0) return "—";
    return (lastHits / (gameTime / 60)).toFixed(1);
  }

  function formatClockLabel(nextAt) {
    return `at ${formatClock(nextAt)}`;
  }

  function nextFixedCycle(clock, firstSpawn, interval) {
    if (!Number.isFinite(clock) || interval <= 0) {
      return { remaining: NaN, nextAt: firstSpawn, phase: "countdown", nextLabel: "—" };
    }
    if (clock < firstSpawn) {
      const remaining = firstSpawn - clock;
      return { remaining, nextAt: firstSpawn, phase: remaining < 1 ? "now" : "countdown", nextLabel: formatClockLabel(firstSpawn) };
    }
    const elapsed = clock - firstSpawn;
    const into = elapsed % interval;
    if (into < 1) {
      const spawnAt = firstSpawn + Math.floor(elapsed / interval) * interval;
      return { remaining: 0, nextAt: spawnAt, phase: "now", nextLabel: "SPAWNING" };
    }
    const remaining = interval - into;
    const nextAt = clock + remaining;
    return { remaining, nextAt, phase: remaining < 1 ? "now" : "countdown", nextLabel: formatClockLabel(nextAt) };
  }

  function parseMapSide(value) {
    const team = value?.toLowerCase();
    if (team === "radiant" || team === "dire") return team;
    return null;
  }

  function enemySideOf(team) {
    return team === "radiant" ? "dire" : "radiant";
  }

  function isNaturalDaytime(clock) {
    if (!Number.isFinite(clock) || clock < 0) return true;
    return Math.floor(clock / DAY_NIGHT_INTERVAL) % 2 === 0;
  }

  function tormentorSideAt(clock) {
    return isNaturalDaytime(clock) ? "radiant" : "dire";
  }

  function nextDayNightFlip(clock) {
    if (!Number.isFinite(clock)) return DAY_NIGHT_INTERVAL;
    const into = ((clock % DAY_NIGHT_INTERVAL) + DAY_NIGHT_INTERVAL) % DAY_NIGHT_INTERVAL;
    if (into < 1) return clock + DAY_NIGHT_INTERVAL;
    return clock + (DAY_NIGHT_INTERVAL - into);
  }

  function nextTimeOnSide(fromClock, side) {
    const start = Math.max(fromClock, TORMENTOR_FIRST);
    if (tormentorSideAt(start) === side) return start;
    return nextDayNightFlip(start);
  }

  function sideLabel(side) {
    return side === "radiant" ? "Radiant" : "Dire";
  }

  function tormentorStatus(clock, claimed, playerTeam) {
    const team = parseMapSide(playerTeam);
    const enemySide = team ? enemySideOf(team) : null;
    if (!Number.isFinite(clock)) {
      return {
        remaining: NaN, nextAt: TORMENTOR_FIRST, phase: "countdown", nextLabel: "—",
        alive: false, side: tormentorSideAt(TORMENTOR_FIRST), playerTeam: team, enemySide, enemyNextAt: NaN,
      };
    }
    const spawnAt =
      clock < TORMENTOR_FIRST
        ? TORMENTOR_FIRST
        : claimed != null && clock < claimed + TORMENTOR_RESPAWN
          ? claimed + TORMENTOR_RESPAWN
          : null;
    const alive = spawnAt == null;
    const side = tormentorSideAt(alive ? clock : spawnAt);
    const enemyNextAt = enemySide == null ? NaN : nextTimeOnSide(alive ? clock : spawnAt, enemySide);
    if (!alive) {
      const remaining = spawnAt - clock;
      return {
        remaining, nextAt: spawnAt, phase: remaining < 1 ? "now" : "countdown",
        nextLabel: `at ${formatClock(spawnAt)} · ${sideLabel(side)}`,
        alive: false, side, playerTeam: team, enemySide, enemyNextAt,
      };
    }
    const onEnemy = enemySide != null && side === enemySide;
    return {
      remaining: 0, nextAt: clock, phase: "active",
      nextLabel: onEnemy ? "ENEMY SIDE" : `${sideLabel(side)} SIDE`,
      alive: true, side, playerTeam: team, enemySide, enemyNextAt,
    };
  }

  function tormentorAlertStatus(clock, view, claimed) {
    if (view.enemySide == null || !Number.isFinite(view.enemyNextAt)) {
      if (view.alive) return { remaining: 0, nextAt: view.nextAt, phase: "active", nextLabel: view.nextLabel };
      return view;
    }
    if (view.alive && view.side === view.enemySide) {
      const lastAppear =
        claimed != null && claimed + TORMENTOR_RESPAWN <= clock
          ? claimed + TORMENTOR_RESPAWN
          : TORMENTOR_FIRST;
      const intoPeriod = ((clock % DAY_NIGHT_INTERVAL) + DAY_NIGHT_INTERVAL) % DAY_NIGHT_INTERVAL;
      const justArrived = clock - lastAppear < 1 || intoPeriod < 1;
      if (justArrived) return { remaining: 0, nextAt: view.enemyNextAt, phase: "now", nextLabel: "ENEMY SIDE" };
      return { remaining: 0, nextAt: view.enemyNextAt, phase: "active", nextLabel: "ENEMY SIDE" };
    }
    const remaining = view.enemyNextAt - clock;
    return {
      remaining, nextAt: view.enemyNextAt,
      phase: remaining < 1 ? "now" : "countdown",
      nextLabel: `enemy at ${formatClock(view.enemyNextAt)}`,
    };
  }

  function stackStatus(clock) {
    if (!Number.isFinite(clock)) {
      return { remaining: NaN, nextAt: STACK_FIRST_WINDOW, phase: "countdown", nextLabel: "—" };
    }
    if (clock < STACK_FIRST_WINDOW) {
      const remaining = STACK_FIRST_WINDOW - clock;
      return { remaining, nextAt: STACK_FIRST_WINDOW, phase: remaining < 1 ? "window" : "countdown", nextLabel: formatClockLabel(STACK_FIRST_WINDOW) };
    }
    const sec = ((clock % 60) + 60) % 60;
    if (sec >= STACK_WINDOW_START && sec <= STACK_WINDOW_END) {
      const windowAt = clock - (sec - STACK_WINDOW_START);
      return { remaining: 0, nextAt: windowAt, phase: "window", nextLabel: "STACK NOW" };
    }
    const remaining = sec < STACK_WINDOW_START ? STACK_WINDOW_START - sec : 60 - sec + STACK_WINDOW_START;
    const nextAt = clock + remaining;
    return { remaining, nextAt, phase: remaining < 1 ? "window" : "countdown", nextLabel: formatClockLabel(nextAt) };
  }

  function isWarning(remaining, warn, phase) {
    if (warn <= 0) return false;
    if (phase === "active" || phase === "now" || phase === "window") return false;
    return remaining > 0 && remaining <= warn;
  }

  function isEndedMatch(s) {
    if (!s) return false;
    if (s.status === "ended") return true;
    if (s.status === "idle") return false;
    const gs = s.match?.state ?? "";
    const win = (s.match?.winTeam ?? "none").toLowerCase();
    return gs.includes("POST_GAME") || (win !== "none" && win !== "");
  }

  function isMenuOrHollowMatch(s) {
    if (!s || s.status === "ended") return false;
    const gs = s.match?.state ?? "";
    if (gs.includes("INIT") || gs.includes("DISCONNECT") || gs.includes("CUSTOM_GAME_SETUP")) return true;
    const hasHero = Boolean(s.hero?.name);
    const inMatch =
      gs.includes("HERO_SELECTION") || gs.includes("STRATEGY_TIME") || gs.includes("TEAM_SHOWCASE") ||
      gs.includes("WAIT_FOR") || gs.includes("PRE_GAME") || gs.includes("GAME_IN_PROGRESS") || gs.includes("POST_GAME");
    if (inMatch || hasHero) return false;
    return true;
  }

  function isPausedMatch(s, now = Date.now()) {
    if (!s || s.status === "idle" || isEndedMatch(s) || isMenuOrHollowMatch(s)) return false;
    if (s.match?.paused) return true;
    const last = s.gsi?.lastSeenAt ?? s.updatedAt;
    return now - last >= 8000;
  }

  function isIdleState(s) {
    if (!s || s.status === "idle") return true;
    if (isEndedMatch(s)) return false;
    if (isMenuOrHollowMatch(s)) return true;
    if (isPausedMatch(s)) return false;
    if (s.status === "live") return false;
    return !(s.match?.id || s.match?.state || s.match?.clockTime != null);
  }

  function isLiveMatch(s) {
    return Boolean(s) && !isIdleState(s) && !isEndedMatch(s);
  }

  function winnerLabel(winTeam) {
    const win = (winTeam ?? "").toLowerCase();
    if (win === "radiant") return "Radiant victory";
    if (win === "dire") return "Dire victory";
    return null;
  }

  const CLOCK_LEAD = 3;
  const MAX_LIVE_DRIFT = 8;

  function liveClock(s, live) {
    const clockTime = s?.match?.clockTime;
    if (clockTime == null || Number.isNaN(clockTime)) return undefined;
    if (!live) return clockTime;
    const base = s.gsi?.lastSeenAt ?? s.updatedAt ?? Date.now();
    const drift = Math.min(MAX_LIVE_DRIFT, Math.max(0, (Date.now() - base) / 1000));
    return clockTime + drift + CLOCK_LEAD;
  }

  function cycleCards(clock) {
    return [
      { id: "powerRune", name: "Power Rune", description: `First ${formatClock(POWER_RUNE_FIRST)}, then every 2 min`, badge: "6:00", color: "#5eb0f0", status: nextFixedCycle(clock, POWER_RUNE_FIRST, POWER_RUNE_INTERVAL) },
      { id: "wisdomRune", name: "Wisdom Rune", description: `First ${formatClock(WISDOM_RUNE_FIRST)}, then every 7 min`, badge: "7:00", color: "#c4b5fd", status: nextFixedCycle(clock, WISDOM_RUNE_FIRST, WISDOM_RUNE_INTERVAL) },
      { id: "lotus", name: "Lotus Pool", description: `First ${formatClock(LOTUS_FIRST)}, then every 3 min`, badge: "3:00", color: "#3ddab4", status: nextFixedCycle(clock, LOTUS_FIRST, LOTUS_INTERVAL), extra: clock >= LOTUS_FIRST ? "FRUIT UP" : undefined },
      { id: "stack", name: "Camp Stack", description: `Camps from ${formatClock(CAMP_FIRST_SPAWN)} · first pull ${formatClock(STACK_FIRST_WINDOW)}`, badge: `:${STACK_WINDOW_START}`, color: "#a1a1aa", status: stackStatus(clock) },
    ];
  }

  function alertFromStatus(id, name, status, warn, color) {
    if (warn <= 0 || status.phase === "active") return null;
    const cycleAt = Number.isFinite(status.nextAt) ? Math.round(status.nextAt) : 0;
    if (status.phase === "now" || status.phase === "window") {
      return { id, name, remaining: 0, tone: "now", color, cycleAt };
    }
    return {
      id,
      name,
      remaining: status.remaining,
      tone: isWarning(status.remaining, warn, status.phase) ? "warn" : "upcoming",
      color,
      cycleAt,
    };
  }

  function collectTimerAlerts(clock, team) {
    if (clock == null) return [];
    const items = [];
    for (const card of cycleCards(clock)) {
      const item = alertFromStatus(card.id, card.name, card.status, warnSeconds[card.id], card.color);
      if (item) items.push(item);
    }
    if (warnSeconds.tormentor > 0) {
      const view = tormentorStatus(clock, claimedAt, team);
      const alert = tormentorAlertStatus(clock, view, claimedAt);
      const name = view.enemySide ? "Tormentor · Enemy" : "Tormentor";
      const item = alertFromStatus("tormentor", name, alert, warnSeconds.tormentor, "#e8c547");
      if (item) items.push(item);
    }
    items.sort((a, b) => {
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      const rank = { now: 0, warn: 1, upcoming: 2 };
      return (rank[a.tone] - rank[b.tone]) || a.name.localeCompare(b.name);
    });
    return items;
  }

  function svgIcon(kind, color) {
    const icons = {
      power: '<path d="M12 3v6m0 6v6M7 8c3-4 7-4 10 0M7 16c3 4 7 4 10 0"/>',
      book: '<path d="M4 5h7v14H4zM13 5h7v14h-7z"/>',
      leaf: '<path d="M5 19c8-1 13-8 14-14-6 1-13 6-14 14zM9 15l6-6"/>',
      stack: '<path d="M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4"/>',
      shield: '<path d="M12 3l7 4v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/>',
    };
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">${icons[kind]}</svg>`;
  }

  function slotHtml(name, extraClass = "") {
    const src = itemImageUrl(name);
    return `<div class="slot ${extraClass}" title="${name ? name.replace(/^item_/, "").replace(/_/g, " ") : "Empty"}">${src ? `<img src="${src}" alt="" />` : ""}</div>`;
  }

  function hpSegments(pct) {
    return Array.from({ length: 12 }, (_, i) => `<i class="${(i + 1) / 12 <= pct / 100 ? "on" : ""}"></i>`).join("");
  }

  function setSwitch(el, on) {
    el.classList.toggle("on", on);
  }

  function openSoundDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SOUND_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SOUND_STORE)) db.createObjectStore(SOUND_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  function soundDbRequest(mode, run) {
    return openSoundDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(SOUND_STORE, mode);
          const store = tx.objectStore(SOUND_STORE);
          const req = run(store);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
        }),
    );
  }

  function readSoundBlob(id) {
    return soundDbRequest("readonly", (store) => store.get(id));
  }

  function writeSoundBlob(id, blob) {
    return soundDbRequest("readwrite", (store) => store.put(blob, id));
  }

  function deleteSoundBlob(id) {
    return soundDbRequest("readwrite", (store) => store.delete(id));
  }

  function revokeSoundUrl(id) {
    if (soundUrls[id]) {
      URL.revokeObjectURL(soundUrls[id]);
      delete soundUrls[id];
    }
  }

  async function ensureSoundUrl(id) {
    if (soundUrls[id]) return soundUrls[id];
    const blob = await readSoundBlob(id);
    if (!(blob instanceof Blob)) return null;
    soundUrls[id] = URL.createObjectURL(blob);
    return soundUrls[id];
  }

  async function resolveSoundUrl(id) {
    if (!id) return null;
    if (settings.soundNames?.[id]) {
      const custom = await ensureSoundUrl(id);
      if (custom) return custom;
    }
    return SOUND_BY_ID[id]?.file || null;
  }

  async function playAlertSound(id) {
    if (!id) return false;
    try {
      const url = await resolveSoundUrl(id);
      if (!url) return false;
      if (activeSound) {
        activeSound.pause();
        activeSound = null;
      }
      const audio = new Audio(url);
      activeSound = audio;
      audio.addEventListener("ended", () => {
        if (activeSound === audio) activeSound = null;
      });
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  function soundFileLabel(id) {
    const custom = settings.soundNames?.[id];
    if (custom) return `Custom: ${custom}`;
    return SOUND_BY_ID[id]?.builtIn || "Built-in";
  }

  function renderSoundSlots() {
    if (!els.soundSlots) return;
    els.soundSlots.innerHTML = SOUND_SLOTS.map((slot) => {
      const custom = Boolean(settings.soundNames?.[slot.id]);
      return `<div class="sound-row" data-sound-slot="${slot.id}">
        <div>
          <div class="t">${slot.label}</div>
          <div class="h">${soundFileLabel(slot.id)}</div>
        </div>
        <div class="sound-actions">
          <label>
            CHOOSE
            <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" data-sound-file="${slot.id}" />
          </label>
          <button type="button" data-sound-preview="${slot.id}">PREVIEW</button>
          <button type="button" data-sound-clear="${slot.id}" ${custom ? "" : "disabled"}>RESET</button>
        </div>
      </div>`;
    }).join("");
  }

  async function assignSoundFile(id, file) {
    if (!(file instanceof File)) return;
    if (file.size > SOUND_MAX_BYTES) {
      window.alert("Sound file must be 2 MB or smaller.");
      return;
    }
    if (file.type && !file.type.startsWith("audio/")) {
      window.alert("Please choose an audio file (mp3, wav, ogg).");
      return;
    }
    await writeSoundBlob(id, file);
    revokeSoundUrl(id);
    settings.soundNames = { ...settings.soundNames, [id]: file.name };
    persistSettings();
  }

  async function clearSoundFile(id) {
    await deleteSoundBlob(id);
    revokeSoundUrl(id);
    const next = { ...settings.soundNames };
    delete next[id];
    settings.soundNames = next;
    persistSettings();
  }

  function persistSettings() {
    saveJson(SETTINGS_KEY, settings);
    saveJson(WARN_KEY, warnSeconds);
    renderMute();
    renderSoundSlots();
    setSwitch(els.setMuted, settings.muted);
    setSwitch(els.setWarnSound, settings.soundOnWarn);
    setSwitch(els.setSpawnSound, settings.soundOnSpawn);
  }

  function renderMute() {
    els.muteBtn.classList.toggle("muted", settings.muted);
    els.muteBtn.setAttribute("aria-label", settings.muted ? "Unmute alert sounds" : "Mute alert sounds");
  }

  function permissionState() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }

  function renderNotifyBanner() {
    const perm = permissionState();
    els.notifyBanner.classList.remove("ready", "blocked");
    if (perm === "granted") {
      els.notifyBanner.classList.add("ready");
      els.notifyTitle.textContent = "Chrome alerts on";
      els.notifyHint.textContent = "Keep this tab open — Chrome shows match alerts even without a phone app. Background is fine.";
      els.notifyBtn.textContent = "TEST";
    } else if (perm === "denied" || perm === "unsupported") {
      els.notifyBanner.classList.add("blocked");
      els.notifyTitle.textContent = "Chrome alerts blocked";
      els.notifyHint.textContent = perm === "unsupported"
        ? "This browser cannot show notifications."
        : "In Chrome settings, allow notifications for 127.0.0.1.";
      els.notifyBtn.textContent = "HELP";
    } else {
      els.notifyTitle.textContent = "Chrome match alerts";
      els.notifyHint.textContent = "Chrome will notify you for runes, lotus, wisdom, and tormentor — no phone app needed. Keep this tab open (background is fine).";
      els.notifyBtn.textContent = "ENABLE";
    }
  }

  function buildNotifyIcon() {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 96, 96);
      notifyIcon = c.toDataURL("image/png");
    };
    img.onerror = () => {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const g = c.getContext("2d");
      g.fillStyle = "#e85a1a";
      g.beginPath();
      g.arc(48, 48, 44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#070b10";
      g.font = "bold 28px Segoe UI, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("SA", 48, 52);
      notifyIcon = c.toDataURL("image/png");
    };
    img.src = "/icon-128.png";
  }

  async function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      swReg = await navigator.serviceWorker.register("/sw.js");
    } catch {
      swReg = null;
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") {
      window.open("https://support.google.com/chrome/answer/3220216", "_blank");
      return;
    }
    const result = await Notification.requestPermission();
    renderNotifyBanner();
    if (result === "granted") {
      await registerWorker();
      void notify("Dota Spawn Alarm", "Chrome alerts are on. Keep this tab open during matches.", "ready");
    }
  }

  function soundAllowed(tone) {
    if (settings.muted) return false;
    if (tone === "warn" && !settings.soundOnWarn) return false;
    if (tone === "now" && !settings.soundOnSpawn) return false;
    return true;
  }

  async function notify(title, body, tag, tone, soundId) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const allowSound = soundAllowed(tone);
    let playedAlert = false;
    if (allowSound && soundId) {
      playedAlert = await playAlertSound(soundId);
    }
    // Our per-alert tone replaces Chrome's default ding when it plays.
    const silent = !allowSound || playedAlert;
    const payload = {
      type: "notify",
      title,
      body,
      tag,
      icon: notifyIcon,
      silent,
    };
    if (swReg?.active) {
      swReg.active.postMessage(payload);
      return;
    }
    try {
      new Notification(title, {
        body,
        tag,
        icon: notifyIcon,
        silent,
      });
    } catch {
      /* ignore */
    }
  }

  function emitGameNotifications(s, alerts, live, ended) {
    const status = ended ? "ended" : live ? "live" : "idle";
    if ((prevStatus === "idle" || prevStatus == null) && status === "live") {
      void notify("Match started", `${formatHeroName(s.hero?.name)} is live`, "match-start", "now", "match");
    }
    if (prevStatus && prevStatus !== "ended" && status === "ended") {
      void notify("Match ended", winnerLabel(s.match?.winTeam) || "Game over", "match-end", "now", "match");
    }
    prevStatus = status;

    const alive = s.hero?.alive;
    if (live && prevAlive === true && alive === false) {
      const respawn = s.hero?.respawnSeconds ?? 0;
      void notify("You died", respawn ? `Respawn in ${respawn}s` : "Waiting to respawn", "death", "warn", "death");
    }
    prevAlive = alive;

    if (!live) {
      seenAlerts.clear();
      return;
    }
    const clock = liveClock(s, true);
    for (const item of alerts) {
      if (item.tone === "upcoming") continue;
      // Key by spawn cycle so clock jitter cannot re-fire the same alert.
      const key = `${item.id}:${item.tone}:${item.cycleAt ?? 0}`;
      if (seenAlerts.has(key)) continue;
      seenAlerts.add(key);
      const title = item.tone === "now" ? `${item.name} NOW` : `${item.name} incoming`;
      const body = item.tone === "now" ? "Objective window is open" : `${formatCountdown(item.remaining)} remaining`;
      void notify(title, body, key, item.tone, item.id);
    }
    // Drop cycles that are clearly in the past; do not clear on brief warn flicker.
    if (Number.isFinite(clock)) {
      for (const key of [...seenAlerts]) {
        const cycleAt = Number(key.split(":").pop());
        if (Number.isFinite(cycleAt) && cycleAt < clock - 180) seenAlerts.delete(key);
      }
    }
  }

  function renderConnection() {
    const connected = wsStatus === "connected";
    const connecting = wsStatus === "connecting";
    const gsi = state?.gsi;
    const live = isLiveMatch(state);
    let label = "OFFLINE";
    let cls = "bad";
    if (connecting) {
      label = "SYNCING";
      cls = "warn";
    } else if (connected && live) {
      label = "IN MATCH";
      cls = "ok";
    } else if (connected && gsi?.connected) {
      label = "DOTA LINKED";
      cls = "ok";
    } else if (connected && gsi?.dotaRunning) {
      label = "IN MENU";
      cls = "warn";
    } else if (connected) {
      label = "RELAY ON";
      cls = "warn";
    }
    els.gsiBadge.textContent = label;
    els.gsiBadge.className = `badge ${cls}`;
    els.statusDot.className = `dot ${cls}`;
    els.latency.textContent = latencyMs != null ? `${latencyMs}ms` : connected ? "live" : "—";
    els.latency.classList.toggle("ok", connected && Boolean(live || gsi?.connected));
  }

  function setStep(el, ok, warn) {
    el.className = `wait-step ${ok ? "ok" : warn ? "warn" : "bad"}`;
  }

  function renderWaiting() {
    const connected = wsStatus === "connected";
    const connecting = wsStatus === "connecting";
    const gsi = state?.gsi;
    const dotaOn = Boolean(gsi?.dotaRunning);
    const gsiOn = Boolean(gsi?.connected);
    els.waitingIcon.classList.toggle("bad", !connected && !connecting);
    els.waitingIcon.classList.toggle("warn", connected && dotaOn && !gsiOn);
    setStep(els.stepRelay, connected, connecting);
    setStep(els.stepDota, dotaOn, connected);
    setStep(els.stepMatch, false, gsiOn);
    if (!connected && connecting) {
      els.waitingTitle.textContent = "Connecting to relay";
      els.waitingDetail.textContent = "Reaching 127.0.0.1 on port 3500…";
      return;
    }
    if (!connected) {
      els.waitingTitle.textContent = "Relay unreachable";
      els.waitingDetail.textContent = "Could not reach the local relay. Confirm the tray app is running.";
      return;
    }
    if (!dotaOn) {
      els.waitingTitle.textContent = "Open Dota 2";
      els.waitingDetail.textContent = "Relay is on, but Dota 2 is not running. Launch the game, then join a match.";
      return;
    }
    if (gsiOn) {
      els.waitingTitle.textContent = "Dota is linked — join a match";
      els.waitingDetail.textContent =
        "GSI is reaching the relay, but you are not in a live game yet. Hero pick, loading, or the match itself will fill this HUD.";
      return;
    }
    els.waitingTitle.textContent = "Dota 2 is open — waiting for a match";
    els.waitingDetail.textContent =
      "The main menu sends no GSI data. Join a match (ranked, unranked, bots, or lobby). This HUD fills once you pick a hero. If you are already in a match, fully quit Dota and reopen so the GSI config loads.";
  }

  function renderInventory(items) {
    const bySlot = new Map((items ?? []).map((item) => [item.slot, item.name]));
    els.invTop.innerHTML = ["slot0", "slot1", "slot2"].map((slot) => slotHtml(bySlot.get(slot))).join("");
    els.invBottom.innerHTML = ["slot3", "slot4", "slot5"].map((slot) => slotHtml(bySlot.get(slot))).join("");
    els.invSide.innerHTML = slotHtml(bySlot.get("teleport0")) + slotHtml(bySlot.get("neutral0"));
    const pack = ["slot6", "slot7", "slot8"];
    const hasPack = pack.some((slot) => bySlot.has(slot));
    els.backpack.classList.toggle("hidden", !hasPack);
    if (hasPack) els.backpack.innerHTML = pack.map((slot) => slotHtml(bySlot.get(slot), "sm")).join("");
  }

  function remainText(status) {
    return status.phase === "now" || status.phase === "window" ? "00:00" : formatCountdown(status.remaining);
  }

  function timerLayoutKey(view) {
    return JSON.stringify({
      warn: warnSeconds,
      claimedAt,
      alive: view.alive,
      hasEnemy: view.enemySide != null,
    });
  }

  function patchTimerValues(cards, view, enemyAlert) {
    for (const card of cards) {
      const el = els.timerCards.querySelector(`[data-card="${card.id}"]`);
      if (!el) continue;
      const warn = isWarning(card.status.remaining, warnSeconds[card.id], card.status.phase);
      const hot = warn || card.status.phase === "now" || card.status.phase === "window";
      el.classList.toggle("hot", hot);
      const remain = el.querySelector("[data-remain]");
      const next = el.querySelector("[data-next]");
      if (remain) {
        remain.textContent = remainText(card.status);
        remain.style.color = hot ? "#e8c547" : card.color;
      }
      if (next) next.textContent = card.status.nextLabel;
    }
    const torm = els.timerCards.querySelector('[data-card="tormentor"]');
    if (!torm) return;
    const remain = torm.querySelector("[data-remain]");
    const next = torm.querySelector("[data-next]");
    const enemyRemain = torm.querySelector("[data-enemy-remain]");
    if (!view.alive && remain) remain.textContent = formatCountdown(view.remaining);
    if (!view.alive && next) next.textContent = view.nextLabel;
    if (enemyRemain && enemyAlert.phase !== "now") {
      enemyRemain.textContent = formatCountdown(enemyAlert.remaining);
    }
  }

  function renderTimers(clock, team) {
    els.timerClock.textContent = formatClock(clock);
    if (clock == null || !Number.isFinite(clock)) {
      if (els.timerCards.dataset.mode !== "empty") {
        els.timerCards.dataset.mode = "empty";
        delete els.timerCards.dataset.layout;
        els.timerCards.innerHTML = `<div class="cycle"><p class="hint" style="margin:0">Waiting for match clock from GSI.</p></div>`;
      }
      return;
    }
    const cards = cycleCards(clock);
    const view = tormentorStatus(clock, claimedAt, team);
    const enemyAlert = tormentorAlertStatus(clock, view, claimedAt);
    const layout = timerLayoutKey(view);
    const editingWarn = document.activeElement instanceof HTMLInputElement
      && document.activeElement.hasAttribute("data-warn-input")
      && els.timerCards.contains(document.activeElement);
    if (editingWarn || (els.timerCards.dataset.mode === "cards" && els.timerCards.dataset.layout === layout)) {
      if (!editingWarn) els.timerCards.dataset.layout = layout;
      patchTimerValues(cards, view, enemyAlert);
      return;
    }
    els.timerCards.dataset.mode = "cards";
    els.timerCards.dataset.layout = layout;
    els.timerCards.innerHTML = cards.map((card) => cycleCardHtml(card)).join("") + tormentorHtml(clock, view, enemyAlert);
  }

  function warnControl(id) {
    const value = warnSeconds[id] ?? 0;
    const off = value <= 0;
    return `<div class="warn-row">
      <div class="warn-label" data-warn-label="${id}">${off ? "Alert off" : "Alert before"}</div>
      <div class="warn-ctrl">
        <button type="button" data-warn="${id}" data-delta="-${WARN_STEP}" ${value <= WARN_MIN ? "disabled" : ""}>−</button>
        <input class="warn-val mono" type="text" inputmode="numeric" enterkeyhint="done" data-warn-input="${id}" value="${value}" aria-label="Seconds before ${id} alert" />
        <span class="warn-unit">s</span>
        <button type="button" data-warn="${id}" data-delta="${WARN_STEP}" ${value >= WARN_MAX ? "disabled" : ""}>+</button>
      </div>
    </div>`;
  }

  function cycleCardHtml(card) {
    const { status } = card;
    const warn = isWarning(status.remaining, warnSeconds[card.id], status.phase);
    const hot = warn || status.phase === "now" || status.phase === "window";
    const timerColor = status.phase === "now" || status.phase === "window" ? "#e8c547" : card.color;
    const iconKind = { powerRune: "power", wisdomRune: "book", lotus: "leaf", stack: "stack" }[card.id];
    return `<article class="cycle ${hot ? "hot" : ""}" data-card="${card.id}">
      <div class="cycle-top">
        <div class="cycle-icon" style="background:${card.color}22">${svgIcon(iconKind, card.color)}</div>
        <div class="cycle-body">
          <div class="row-inline">
            <span class="cycle-name">${card.name}</span>
            <span class="badge" style="border-color:var(--line);color:var(--zinc-400)">${card.badge}</span>
            ${card.extra ? `<span class="badge ok">${card.extra}</span>` : ""}
            ${hot ? `<span class="badge warn">${status.phase === "now" || status.phase === "window" ? "NOW" : "WARN"}</span>` : ""}
          </div>
          <div class="cycle-desc">${card.description}</div>
        </div>
        <div class="cycle-time">
          <div class="cycle-remain mono" data-remain style="color:${timerColor}">${remainText(status)}</div>
          <div class="cycle-next" data-next style="color:${card.color}">${status.nextLabel}</div>
        </div>
      </div>
      ${warnControl(card.id)}
    </article>`;
  }

  function tormentorHtml(clock, view, enemyAlert) {
    const hot =
      isWarning(enemyAlert.remaining, warnSeconds.tormentor, enemyAlert.phase) ||
      enemyAlert.phase === "now" ||
      view.phase === "now";
    const canUndo = claimedAt != null && !view.alive;
    const canClaim = view.alive;
    const enemyReady = view.alive && view.enemySide != null && view.side === view.enemySide;
    const relation = view.enemySide == null ? null : view.side === view.enemySide ? "ENEMY" : "ALLY";
    return `<article class="cycle ${hot ? "hot" : ""}" data-card="tormentor">
      <div class="cycle-top">
        <div class="cycle-icon" style="background:#e8c54722">${svgIcon("shield", "#e8c547")}</div>
        <div class="cycle-body">
          <div class="row-inline">
            <span class="cycle-name">Tormentor</span>
            <span class="badge warn">${clock < TORMENTOR_FIRST ? "20:00" : "10 MIN"}</span>
            ${relation ? `<span class="badge warn">${relation}</span>` : ""}
          </div>
          <div class="cycle-desc">First ${formatClock(TORMENTOR_FIRST)} · day Radiant, night Dire</div>
        </div>
      </div>
      <div class="torm-row">
        <div class="torm-side ${view.side}">${sideLabel(view.side).toUpperCase()}</div>
        <div class="grow">${view.alive
          ? `<strong style="color:var(--gold);font-size:12px">${enemyReady ? "ON ENEMY SIDE" : "SHARD READY"}</strong>`
          : `<span class="mono" data-remain style="font-size:16px;font-weight:700">${formatCountdown(view.remaining)}</span> <span class="kicker" data-next>${view.nextLabel}</span>`
        }</div>
        <button type="button" class="claim-btn ${canClaim || canUndo ? "on" : ""}" data-claim="${canUndo ? "undo" : "claim"}" ${!canClaim && !canUndo ? "disabled" : ""}>${canUndo ? "UNDO" : "CLAIM"}</button>
      </div>
      ${view.enemySide != null
        ? `<div class="torm-row"><span class="kicker">Enemy pit</span><div class="grow" style="text-align:right">${enemyReady ? `<strong style="color:var(--gold)">NOW</strong>` : `<span class="mono" data-enemy-remain>${formatCountdown(enemyAlert.remaining)}</span> <span class="kicker">${sideLabel(view.enemySide)} · ${formatClock(view.enemyNextAt)}</span>`}</div></div>`
        : `<p class="hint">Enemy spawn needs your team from GSI. First pit is Radiant at 20:00.</p>`}
      ${warnControl("tormentor")}
    </article>`;
  }

  function render() {
    renderConnection();
    renderNotifyBanner();
    const s = state;
    const live = isLiveMatch(s);
    const ended = isEndedMatch(s) && !isIdleState(s);
    const paused = isPausedMatch(s);
    const waiting = !s || isIdleState(s);
    const clock = liveClock(s, live && wsStatus === "connected" && !paused);
    const alerts = live ? collectTimerAlerts(clock, s?.player?.team) : [];
    // Timers stay usable before a match — preview the schedule from 0:00.
    const showWaiting = waiting && tab !== "timers";
    const previewClock = waiting ? (clock ?? 0) : clock;

    els.waiting.classList.toggle("hidden", !showWaiting);
    els.live.classList.toggle("idle", showWaiting);
    if (waiting) {
      renderWaiting();
      if (tab === "timers") {
        els.timerBadge.classList.add("hidden");
        els.alerts.innerHTML = "";
        els.pauseBanner.classList.add("hidden");
        els.endedBanner.classList.add("hidden");
        renderTimers(previewClock, s?.player?.team);
      }
      emitGameNotifications(s || {}, alerts, false, false);
      return;
    }

    els.pauseBanner.classList.toggle("hidden", !(paused && !ended));
    els.endedBanner.classList.toggle("hidden", !ended);
    els.winnerLabel.textContent = winnerLabel(s.match?.winTeam) || "";

    const hotAlerts = alerts.filter((item) => item.tone !== "upcoming");
    els.alerts.innerHTML = (ended ? [] : alerts).map((item) => `
      <div class="alert-row ${item.tone}">
        <div class="alert-name"><span class="alert-dot" style="background:${item.color}"></span>${item.name}</div>
        <div class="alert-time mono">${item.tone === "now" ? "NOW" : formatCountdown(item.remaining)}</div>
      </div>`).join("");
    els.timerBadge.textContent = String(hotAlerts.length);
    els.timerBadge.classList.toggle("hidden", hotAlerts.length === 0);

    const cycle = dayNightFromClock(clock);
    els.radiantScore.textContent = String(s.match?.radiantScore ?? 0);
    els.direScore.textContent = String(s.match?.direScore ?? 0);
    els.clockValue.textContent = formatClock(clock);
    els.clockLabel.textContent = ended ? "FINAL" : paused ? "PAUSE" : cycle === "day" ? "DAY CYCLE" : "NIGHT CYCLE";
    els.clockLabel.className = `score-label clock-label ${ended || paused ? "gold" : cycle}`;

    const hero = s.hero || {};
    const player = s.player || {};
    const portrait = heroImageUrl(hero.name);
    if (portrait) {
      els.heroImg.src = portrait;
      els.heroImg.style.display = "block";
    } else {
      els.heroImg.removeAttribute("src");
      els.heroImg.style.display = "none";
    }
    els.heroLvl.textContent = `LVL ${hero.level ?? "—"}`;
    els.heroName.textContent = formatHeroName(hero.name);
    els.heroTeam.textContent = (player.team ?? "radiant").toUpperCase();
    els.heroTeam.className = player.team === "dire" ? "team-dire" : "team-radiant";
    els.liveTag.textContent = ended ? "ENDED" : "LIVE";
    els.liveTag.classList.toggle("ended", ended);
    els.gpm.textContent = formatNumber(player.gpm);
    els.xpm.textContent = formatNumber(player.xpm);
    els.goldAmt.textContent = `${formatNumber(player.gold)}g`;
    const alive = hero.alive !== false;
    els.alivePill.textContent = alive ? "ALIVE" : `RESPAWN ${hero.respawnSeconds ?? 0}s`;
    els.alivePill.className = `alive-pill ${alive ? "on" : "off"}`;

    const kills = player.kills ?? 0;
    const deaths = player.deaths ?? 0;
    const assists = player.assists ?? 0;
    const ratio = kdaRatio(kills, deaths, assists);
    els.kills.textContent = String(kills);
    els.deaths.textContent = String(deaths);
    els.assists.textContent = String(assists);
    els.impactN.textContent = ratio.toFixed(1);
    els.impactS.textContent = ratio >= 4 ? "HIGH" : ratio >= 2 ? "SOLID" : "LOW";
    els.lastHits.textContent = formatNumber(player.lastHits);
    els.denies.textContent = formatNumber(player.denies);
    els.farmRate.textContent = `${farmPerMinute(player.lastHits, s.match?.gameTime ?? s.match?.clockTime)}/m`;

    const hpPct = Math.max(0, Math.min(100, hero.healthPercent ?? 0));
    const mpPct = Math.max(0, Math.min(100, hero.manaPercent ?? 0));
    els.hpLabel.textContent = `HP: ${formatNumber(hero.health)} / ${formatNumber(hero.maxHealth)}`;
    els.hpPct.textContent = `${Math.round(hpPct)}%`;
    els.hpSeg.innerHTML = hpSegments(hpPct);
    els.mpLabel.textContent = `MANA: ${formatNumber(hero.mana)} / ${formatNumber(hero.maxMana)}`;
    els.mpPct.textContent = `${Math.round(mpPct)}%`;
    els.mpFill.style.width = `${mpPct}%`;
    renderInventory(s.items);
    renderTimers(clock, player.team);
    emitGameNotifications(s, alerts, live, ended);
  }

  function setTab(next) {
    tab = next;
    document.body.dataset.tab = tab;
    els.tabMatch.classList.toggle("active", tab === "match");
    els.tabTimers.classList.toggle("active", tab === "timers");
    els.paneMatch.classList.toggle("active", tab === "match");
    els.paneTimers.classList.toggle("active", tab === "timers");
    render();
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);
    wsStatus = "connecting";
    renderConnection();
    renderWaiting();
    ws.onopen = () => {
      wsStatus = "connected";
      lastPingAt = Date.now();
      render();
    };
    ws.onclose = () => {
      wsStatus = "offline";
      latencyMs = null;
      render();
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (event) => {
      latencyMs = Math.max(0, Date.now() - (lastPingAt || Date.now()));
      lastPingAt = Date.now();
      try {
        state = JSON.parse(event.data);
      } catch {
        return;
      }
      if (state?.match?.id !== matchId) {
        matchId = state?.match?.id;
        claimedAt = null;
        seenAlerts.clear();
        prevAlive = undefined;
      }
      render();
    };
  }

  els.muteBtn.addEventListener("click", () => {
    settings.muted = !settings.muted;
    persistSettings();
  });
  els.settingsBtn.addEventListener("click", () => els.settings.classList.add("open"));
  els.settingsClose.addEventListener("click", () => els.settings.classList.remove("open"));
  els.setMuted.addEventListener("click", () => {
    settings.muted = !settings.muted;
    persistSettings();
  });
  els.setWarnSound.addEventListener("click", () => {
    settings.soundOnWarn = !settings.soundOnWarn;
    persistSettings();
  });
  els.setSpawnSound.addEventListener("click", () => {
    settings.soundOnSpawn = !settings.soundOnSpawn;
    persistSettings();
  });
  els.soundSlots?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    const id = input.getAttribute("data-sound-file");
    const file = input.files?.[0];
    if (!id || !file) return;
    void assignSoundFile(id, file).finally(() => {
      input.value = "";
    });
  });
  els.soundSlots?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    const previewId = btn.getAttribute("data-sound-preview");
    if (previewId) {
      void playAlertSound(previewId);
      return;
    }
    const clearId = btn.getAttribute("data-sound-clear");
    if (clearId) void clearSoundFile(clearId);
  });
  els.resetWarn.addEventListener("click", () => {
    warnSeconds = { ...DEFAULT_WARN };
    persistSettings();
    render();
  });
  els.notifyBtn.addEventListener("click", () => {
    if (permissionState() === "granted") {
      void notify("Dota Spawn Alarm", "Test alert — Chrome notifications are working.", "test", "now", "match");
      return;
    }
    void enableNotifications();
  });
  els.tabMatch.addEventListener("click", () => setTab("match"));
  els.tabTimers.addEventListener("click", () => setTab("timers"));
  function commitWarnInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const id = input.getAttribute("data-warn-input");
    if (!id) return;
    const next = parseWarnInput(input.value);
    input.value = String(next);
    if (applyWarnSeconds(id, next)) render();
    else {
      const label = els.timerCards.querySelector(`[data-warn-label="${id}"]`);
      if (label) label.textContent = next <= 0 ? "Alert off" : "Alert before";
    }
  }

  els.timerCards.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-warn-input]")) return;
    const warnBtn = target.closest("[data-warn]");
    if (warnBtn instanceof HTMLButtonElement) {
      if (warnBtn.disabled) return;
      event.preventDefault();
      const id = warnBtn.getAttribute("data-warn");
      const delta = Number(warnBtn.getAttribute("data-delta"));
      if (applyWarnSeconds(id, (warnSeconds[id] ?? 0) + delta)) render();
      return;
    }
    const claimBtn = target.closest("[data-claim]");
    if (!(claimBtn instanceof HTMLButtonElement) || claimBtn.disabled) return;
    event.preventDefault();
    const clock = liveClock(state, isLiveMatch(state) && wsStatus === "connected" && !isPausedMatch(state));
    if (claimBtn.getAttribute("data-claim") === "undo") claimedAt = null;
    else if (clock != null) claimedAt = clock;
    render();
  });
  els.timerCards.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const input = target?.closest("[data-warn-input]");
    if (input) commitWarnInput(input);
  });
  els.timerCards.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const input = target?.closest("[data-warn-input]");
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
      commitWarnInput(input);
    }
  });

  function demoState(clock) {
    return {
      updatedAt: Date.now(),
      status: "live",
      match: {
        id: "demo",
        clockTime: clock,
        gameTime: clock,
        state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
        radiantScore: 12,
        direScore: 9,
        paused: false,
      },
      player: {
        name: "You",
        team: "radiant",
        gold: 1840,
        gpm: 512,
        xpm: 480,
        kills: 4,
        deaths: 2,
        assists: 7,
        lastHits: 82,
        denies: 11,
      },
      hero: {
        name: "npc_dota_hero_juggernaut",
        level: 12,
        health: 1640,
        maxHealth: 2100,
        healthPercent: 78,
        mana: 420,
        maxMana: 780,
        manaPercent: 54,
        alive: true,
        respawnSeconds: 0,
      },
      items: [
        { slot: "slot0", name: "item_phase_boots" },
        { slot: "slot1", name: "item_manta" },
        { slot: "slot2", name: "item_yasha" },
        { slot: "teleport0", name: "item_tpscroll" },
        { slot: "neutral0", name: "item_possessed_mask" },
      ],
    };
  }

  const PHONE_W = 420;
  const PHONE_H = 820;
  function fitPhoneWindow() {
    try {
      if (typeof window.resizeTo !== "function") return;
      if (window.outerWidth > PHONE_W + 48 || window.outerHeight > PHONE_H + 48) {
        window.resizeTo(PHONE_W, PHONE_H);
      }
    } catch {
      /* browsers may block resize outside script-opened windows */
    }
  }
  fitPhoneWindow();
  requestAnimationFrame(fitPhoneWindow);
  setTimeout(fitPhoneWindow, 120);
  setTimeout(fitPhoneWindow, 500);

  buildNotifyIcon();
  persistSettings();
  renderNotifyBanner();
  if (permissionState() === "granted") void registerWorker();
  setInterval(render, 250);

  if (new URLSearchParams(location.search).has("demo")) {
    wsStatus = "connected";
    let clock = 7 * 60 + 48;
    state = demoState(clock);
    setInterval(() => {
      clock += 0.25;
      state = demoState(clock);
    }, 250);
    render();
  } else {
    connect();
  }
})();
