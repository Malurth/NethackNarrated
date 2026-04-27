export type NethackRuntimeVersion = "3.6.7" | "3.7";

export interface PlayerStats {
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  pw: number;
  max_pw: number;
  ac: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  xp: number;
  xp_level: number;
  gold: number;
  hunger: string;
  score: number;
  turn: number;
  dlvl: number;
}

export interface MonsterEntity {
  type: 'monster';
  x: number;
  y: number;
  name: string;
  givenName?: string;
  /** Unique monster ID from the C engine (m_id). Stable across turns within
   *  a game session — never reused, even after the monster dies. */
  m_id?: number;
  char: string;
  color: number;
  pet: boolean;
}

export interface ItemEntity {
  type: 'item';
  x: number;
  y: number;
  category: string;
  char: string;
  color: number;
  name?: string;
  obscured?: boolean;
  remembered?: boolean;
}

export type Entity = MonsterEntity | ItemEntity;

export interface InventoryItem {
  letter: string;
  text: string;
  oclass: string;
  worn: boolean;
}

export interface GameState {
  type: 'state';
  turn: number;
  dlvl: number;
  map: string[];
  player: PlayerStats;
  messages: string[];
  inventory: InventoryItem[];
  conditions: string[];
  properties: string[];
  warnedMonsters: string[];
  name_title: string;
  role: string;
  race: string;
  gender: string;
  alignment: string;
  entities: Entity[];
  cursor: { x: number; y: number };
  awaiting_input: boolean;
  input_type: string | null;
  prompt: string;
  prompt_choices: string;
  menu_items: { menuChar: string; text: string; isSelectable: boolean }[];
  menu_selection_mode: string | number | null;
  text_window_lines: string[];
  game_over: boolean;
  game_over_reason: string;
  terrain?: TerrainSummary;
  /** Per-tile NetHack color enum (0-15) of the *top glyph* at each tile,
   *  row-major (y * 80 + x). Priority-resolved by NetHack itself — the
   *  color matches whatever `map[y][x].ch` is actually showing (monster
   *  > item > feature > terrain). Use this for rendering; do NOT try to
   *  merge the separate visible{Monsters,Items,Features} lists yourself. */
  mapColors?: Uint8Array;
}

export interface RoomInfo {
  roomNo: number;
  width: number;
  height: number;
  lit: boolean;
  tileCount: number;
}

export interface TerrainFeature {
  name: string;
  x: number;
  y: number;
  inSight: boolean;
}

export interface TerrainExit {
  x: number;
  y: number;
  direction: string;
  type: string;
  /** NetHack color enum (0-15) for this tile, or -1 if unavailable */
  color: number;
}

export interface TerrainSummary {
  playerTerrain: string;
  playerRoom: RoomInfo | null;
  playerLit: boolean;
  nearbyRooms: RoomInfo[];
  features: TerrainFeature[];
  exits: TerrainExit[];
  visibleFloorTiles: number;
  darkLOSTiles: number;
}

export interface TurnRecord {
  turn: number;
  action: string;
  messages: string[];
  diff: string[];
}

export interface PromptRecord {
  type: string;
  query: string;
  answer: string;
}

export interface ActionContext {
  action: Record<string, any>;
  prompts: PromptRecord[];
}

export interface CharacterOptions {
  role?: string;
  race?: string;
  align?: string;
  gender?: string;
  skipTutorial?: boolean;
  name?: string;
  petName?: string;
  slotId?: string;
}

export interface SaveSlot {
  slotId: string;
  version: NethackRuntimeVersion;
  name: string;
  role: string;
  race: string;
  gender: string;
  alignment: string;
  turn: number;
  dlvl: number;
  title: string;
  date: number;
}
