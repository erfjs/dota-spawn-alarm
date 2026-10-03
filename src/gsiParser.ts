import { GsiMap, GsiPayload, IdleCause, MatchStatus, RelayState } from "./types";

// Inventory (0-5), backpack (6-8), TP, and neutral — skip empty slots.
const ITEM_SLOTS = [
  "slot0",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
  "slot6",
  "slot7",
  "slot8",
  "teleport0",
  "neutral0",
];

export function idleRelayState(now = Date.now(), cause: IdleCause = "gsi"): RelayState {
  return {
    updatedAt: now,
    status: "idle",
    idleCause: cause,
    match: {},
    player: {},
    hero: {},
    items: [],
  };
}

export function asPausedLiveState(state: RelayState): RelayState {
  if (state.status !== "live" || state.match.paused) return state;
  return {
    ...state,
    match: { ...state.match, paused: true },
  };
}

export function readPaused(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

export function resolveMatchStatus(body: GsiPayload): MatchStatus {
  const map = body.map;
  if (!map) return "idle";

  const state = map.game_state ?? "";
  const win = (map.win_team ?? "none").toLowerCase();
  if (state.includes("POST_GAME") || (win !== "none" && win !== "")) {
    return "ended";
  }
  // Dashboard / disconnect / custom-lobby payloads still include a map, often
  // with paused=true because the simulation is frozen. That is not a live pause.
  if (isMenuGameState(state) || !hasActiveMap(map)) return "idle";
  return "live";
}

export function isMenuGameState(state: string): boolean {
  return (
    state.includes("INIT") ||
    state.includes("DISCONNECT") ||
    state.includes("CUSTOM_GAME_SETUP")
  );
}

export function isGsiTick(body: GsiPayload): boolean {
  return Boolean(body.provider || body.map || body.player || body.hero || body.items);
}

function isLiveGameState(state: string): boolean {
  return (
    state.includes("HERO_SELECTION") ||
    state.includes("STRATEGY_TIME") ||
    state.includes("TEAM_SHOWCASE") ||
    state.includes("WAIT_FOR_MAP") ||
    state.includes("WAIT_FOR_PLAYERS") ||
    state.includes("PRE_GAME") ||
    state.includes("GAME_IN_PROGRESS")
  );
}

function hasMatchId(map?: GsiMap): boolean {
  const id = map?.matchid;
  return id != null && String(id) !== "" && String(id) !== "0" && String(id) !== "-1";
}

function hasActiveMap(map?: GsiMap): boolean {
  if (!map) return false;
  const state = map.game_state ?? "";
  if (isLiveGameState(state)) return true;
  if (isMenuGameState(state)) return false;
  return hasMatchId(map);
}

function isHollowLivePayload(body: GsiPayload): boolean {
  const state = body.map?.game_state ?? "";
  if (isLiveGameState(state)) return false;
  const heroName = body.hero?.name ?? "";
  return !heroName || heroName === "empty";
}

export function parseGsiPayload(body: GsiPayload): RelayState {
  const status = resolveMatchStatus(body);
  if (status === "idle" || (status === "live" && isHollowLivePayload(body))) {
    return idleRelayState();
  }

  const items = Object.entries(body.items ?? {})
    .filter(([slot, item]) => ITEM_SLOTS.includes(slot) && item?.name && item.name !== "empty")
    .map(([slot, item]) => ({ slot, name: item.name }));

  return {
    updatedAt: Date.now(),
    status,
    match: {
      id: body.map?.matchid != null ? String(body.map.matchid) : undefined,
      gameTime: body.map?.game_time,
      clockTime: body.map?.clock_time,
      state: body.map?.game_state,
      paused: readPaused(body.map?.paused),
      winTeam: body.map?.win_team,
      radiantScore: body.map?.radiant_score,
      direScore: body.map?.dire_score,
    },
    player: {
      name: body.player?.name,
      team: body.player?.team_name,
      gold: body.player?.gold,
      gpm: body.player?.gpm,
      xpm: body.player?.xpm,
      kills: body.player?.kills,
      deaths: body.player?.deaths,
      assists: body.player?.assists,
      lastHits: body.player?.last_hits,
      denies: body.player?.denies,
    },
    hero: {
      name: body.hero?.name,
      level: body.hero?.level,
      health: body.hero?.health,
      maxHealth: body.hero?.max_health,
      healthPercent: body.hero?.health_percent,
      mana: body.hero?.mana,
      maxMana: body.hero?.max_mana,
      manaPercent: body.hero?.mana_percent,
      alive: body.hero?.alive,
      respawnSeconds: body.hero?.respawn_seconds,
    },
    items,
  };
}

export function applyGsiUpdate(body: GsiPayload, previous: RelayState): RelayState {
  const parsed = parseGsiPayload(body);
  const state = body.map?.game_state ?? "";

  if (parsed.status === "idle" && previous.status === "live") {
    if (isMenuGameState(state)) return parsed;
    // Sparse heartbeats omit unchanged blocks — keep the live HUD.
    if (!body.map && isGsiTick(body)) {
      return {
        ...previous,
        updatedAt: Date.now(),
        match: { ...previous.match, paused: false },
      };
    }
  }

  if (parsed.status !== "live" || previous.status !== "live") return parsed;
  if (body.map?.paused === undefined && parsed.match.paused === undefined) {
    return {
      ...parsed,
      match: { ...parsed.match, paused: previous.match.paused },
    };
  }
  return parsed;
}
