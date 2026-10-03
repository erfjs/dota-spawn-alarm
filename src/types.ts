// Partial typing of Dota 2's GSI payload — only the fields this relay uses.
// Full spec: the game sends far more (abilities, buildings, draft, etc.);
// extend these interfaces if you enable more blocks in the .cfg file.

export interface GsiMap {
  matchid?: string | number;
  game_time?: number;
  clock_time?: number;
  game_state?: string;
  paused?: boolean | number | string;
  win_team?: string;
  radiant_score?: number;
  dire_score?: number;
}

export interface GsiPlayer {
  steamid?: string;
  name?: string;
  team_name?: "radiant" | "dire";
  gold?: number;
  gold_reliable?: number;
  gold_unreliable?: number;
  gpm?: number;
  xpm?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  last_hits?: number;
  denies?: number;
}

export interface GsiHero {
  id?: number;
  name?: string;
  level?: number;
  health?: number;
  max_health?: number;
  health_percent?: number;
  mana?: number;
  max_mana?: number;
  mana_percent?: number;
  alive?: boolean;
  respawn_seconds?: number;
  buyback_cost?: number;
  buyback_cooldown?: number;
}

export interface GsiItemSlot {
  name: string;
  purchaser?: number;
  item_level?: number;
  can_cast?: boolean;
  cooldown?: number;
  passive?: boolean;
  charges?: number;
}

export type GsiItems = Record<string, GsiItemSlot>;

export interface GsiProvider {
  name?: string;
  appid?: number;
  version?: number;
  timestamp?: number;
}

export interface GsiPayload {
  provider?: GsiProvider;
  map?: GsiMap;
  player?: GsiPlayer;
  hero?: GsiHero;
  items?: GsiItems;
  auth?: { token?: string };
}

export type MatchStatus = "idle" | "live" | "ended";
export type IdleCause = "gsi" | "timeout";

// The trimmed-down shape this relay actually broadcasts to phones.
export interface RelayState {
  updatedAt: number;
  status: MatchStatus;
  idleCause?: IdleCause;
  match: {
    id?: string;
    gameTime?: number;
    clockTime?: number;
    state?: string;
    paused?: boolean;
    winTeam?: string;
    radiantScore?: number;
    direScore?: number;
  };
  player: {
    name?: string;
    team?: string;
    gold?: number;
    gpm?: number;
    xpm?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    lastHits?: number;
    denies?: number;
  };
  hero: {
    name?: string;
    level?: number;
    health?: number;
    maxHealth?: number;
    healthPercent?: number;
    mana?: number;
    maxMana?: number;
    manaPercent?: number;
    alive?: boolean;
    respawnSeconds?: number;
  };
  items: { slot: string; name: string }[];
  gsi?: {
    packets: number;
    lastSeenAt?: number;
    lastError?: string;
    dotaRunning?: boolean;
    connected?: boolean;
  };
}
