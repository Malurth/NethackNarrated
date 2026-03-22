import type { GameState, MonsterEntity, ItemEntity, TurnRecord } from '../types/game';
import type { LLMEntry, NarrationHeader } from '../types/llm';
import { gameState } from '../state/game.svelte';
import { llmState } from '../state/llm.svelte';
import { shouldTriggerNarration } from './narration-heuristic';
import type { TriggerSnapshot } from './narration-heuristic';
import { formatTerrainForPrompt } from '../utils/terrain-formatter';

/** How many past narration entries to include as context in each new
 *  prompt. 50 entries covers substantial narrative continuity. Token cost
 *  is bounded and predictable; current-state correctness doesn't depend
 *  on this window (that's the state block's job), so it's purely for
 *  tonal continuity. */
export const NARRATION_HISTORY_LIMIT = 50;

/** Map of NetHack's raw condition bit names (as emitted by @neth4ck/api's
 *  `state.conditions`) to player-facing display strings. Covers both the
 *  3.6.7 set and the expanded 3.7 set; unknown bit names pass through
 *  unchanged so a future NetHack release adding a new condition won't
 *  silently drop it. The phrasing is chosen to fit naturally into both
 *  "Active effects: X, Y" listings and "Now X" / "No longer X" diff
 *  lines ("Now flying", "No longer levitating", etc.). */
const CONDITION_DISPLAY_NAMES: Record<string, string> = {
  // Shared 3.6.7 + 3.7 (names are the same, bits differ)
  blind: 'blind',
  conf: 'confused',
  deaf: 'deaf',
  fly: 'flying',
  foodpois: 'food poisoned',
  hallu: 'hallucinating',
  lev: 'levitating',
  ride: 'riding a steed',
  slime: 'turning into slime',
  stone: 'turning to stone',
  strngl: 'strangling',
  stun: 'stunned',
  termill: 'terminally ill',
  // 3.7-only additions
  bareh: 'bare-handed',
  busy: 'busy',
  elf_iron: 'touching cold iron',
  glowhands: 'with glowing hands',
  grab: 'being grabbed',
  held: 'held',
  holding: 'holding on',
  icy: 'on icy footing',
  inlava: 'in lava',
  parlyz: 'paralyzed',
  sleeping: 'asleep',
  slippery: 'on slippery footing',
  submerged: 'submerged',
  tethered: 'tethered',
  trapped: 'trapped',
  unconsc: 'unconscious',
  woundedl: 'with wounded legs',
};

/** Map of NetHack's C-enum property names (from u.uprops[], as exposed
 *  by `game.activeProperties`) to concise LLM-readable descriptions.
 *  The descriptions are phrased to work naturally in both "Active
 *  properties: X, Y" listings and "Gained: X" / "Lost: X" diff lines.
 *
 *  Status-effect properties that duplicate conditions (STUNNED, CONFUSION,
 *  etc.) are omitted — conditions already cover those in the prompt. We
 *  only include properties that provide *information the LLM wouldn't
 *  otherwise have*: resistances, senses, movement modes, and passive
 *  abilities. */
const PROPERTY_DISPLAY_NAMES: Record<string, string> = {
  // ── Resistances ──
  FIRE_RES: 'fire resistance',
  COLD_RES: 'cold resistance',
  SLEEP_RES: 'sleep resistance',
  DISINT_RES: 'disintegration resistance',
  SHOCK_RES: 'shock resistance',
  POISON_RES: 'poison resistance',
  ACID_RES: 'acid resistance',
  STONE_RES: 'petrification resistance',
  DRAIN_RES: 'drain resistance',
  SICK_RES: 'sickness resistance',
  INVULNERABLE: 'invulnerable',
  ANTIMAGIC: 'magic resistance',
  HALLUC_RES: 'hallucination resistance',
  BLND_RES: 'blindness resistance',    // 3.7 only

  // ── Senses & information ──
  SEE_INVIS: 'see invisible',
  TELEPAT: 'telepathy',
  WARNING: 'warning',
  WARN_OF_MON: 'warned of a monster type',
  WARN_UNDEAD: 'warned of undead',
  SEARCHING: 'automatic searching',
  CLAIRVOYANT: 'clairvoyance',
  INFRAVISION: 'infravision',
  DETECT_MONSTERS: 'monster detection',

  // ── Movement & body ──
  ADORNED: 'adornment (charisma bonus)',
  INVIS: 'invisible',
  DISPLACED: 'displaced image',
  STEALTH: 'stealth',
  AGGRAVATE_MONSTER: 'aggravate monster',
  CONFLICT: 'conflict',
  JUMPING: 'can jump',
  TELEPORT: 'teleportitis',
  TELEPORT_CONTROL: 'teleport control',
  LEVITATION: 'levitating',
  FLYING: 'flying',
  WWALKING: 'water walking',
  SWIMMING: 'can swim',
  MAGICAL_BREATHING: 'magical breathing',
  PASSES_WALLS: 'phasing through walls',
  SLOW_DIGESTION: 'slow digestion',
  HALF_SPDAM: 'half spell damage',
  HALF_PHDAM: 'half physical damage',
  REGENERATION: 'regeneration',
  ENERGY_REGENERATION: 'energy regeneration',
  PROTECTION: 'protection (bonus AC)',
  PROT_FROM_SHAPE_CHANGERS: 'protection from shapeshifters',
  POLYMORPH: 'polymorphitis',
  POLYMORPH_CONTROL: 'polymorph control',
  UNCHANGING: 'unchanging',
  FAST: 'speed',
  REFLECTING: 'reflection',
  FREE_ACTION: 'free action',
  FIXED_ABIL: 'fixed abilities',
  LIFESAVED: 'life saving',
};

/** Properties that duplicate conditions and should be excluded from
 *  the properties line to avoid redundancy (conditions already cover
 *  these in the "Active effects" line). */
const CONDITION_OVERLAP_PROPERTIES = new Set([
  'STUNNED', 'CONFUSION', 'BLINDED', 'DEAF', 'SICK', 'STONED',
  'STRANGLED', 'VOMITING', 'GLIB', 'SLIMED', 'HALLUC', 'FUMBLING',
  'WOUNDED_LEGS', 'SLEEPY', 'HUNGER',
]);

/** Translate a raw property enum name (e.g. "FIRE_RES") to its
 *  LLM-readable display form (e.g. "fire resistance"). Unknown
 *  names are lowercased with underscores replaced by spaces.
 *  For WARN_OF_MON, pass `warnedMonsters` to get specific targets
 *  (e.g. "warned of orcs, elves") instead of the generic fallback. */
export function friendlyPropertyName(raw: string, warnedMonsters?: readonly string[]): string {
  if (raw === 'WARN_OF_MON' && warnedMonsters && warnedMonsters.length > 0) {
    return `warned of ${warnedMonsters.join(', ')}`;
  }
  return PROPERTY_DISPLAY_NAMES[raw] ?? raw.toLowerCase().replace(/_/g, ' ');
}

/** Translate a list of raw property names to display form, excluding
 *  properties that are already covered by the conditions system.
 *  Pass `warnedMonsters` to resolve WARN_OF_MON to specific types. */
export function friendlyPropertyList(raws: readonly string[], warnedMonsters?: readonly string[]): string[] {
  return raws
    .filter(p => !CONDITION_OVERLAP_PROPERTIES.has(p))
    .map(p => friendlyPropertyName(p, warnedMonsters));
}

/** Translate a raw condition bit name (e.g. "fly", "foodpois") to its
 *  player-facing display form (e.g. "flying", "food poisoned"). Unknown
 *  names pass through so this is safe to call on any string. */
export function friendlyConditionName(raw: string): string {
  return CONDITION_DISPLAY_NAMES[raw] ?? raw;
}

/** Translate a list of raw condition bit names to display form. */
export function friendlyConditionList(raws: readonly string[]): string[] {
  return raws.map(friendlyConditionName);
}

interface NarrationSnapshot {
  turn: number;
  px: number;
  py: number;
  dlvl: number;
  hp: number;
  maxHp: number;
  pw: number;
  maxPw: number;
  hunger: string;
  conditions: string[];
  properties: string[];
  warnedMonsters: string[];
  monsters: { name: string; x: number; y: number; m_id?: number }[];
  pets: { name: string; x: number; y: number; m_id?: number }[];
  items: { name: string; x: number; y: number }[];
  inventory: { letter: string; text: string }[];
  playerRoomNo: number | null;
  playerInCorridor: boolean;
  playerLit: boolean;
  featureKeys: string[];
  visibleFloorTiles: number;
}

// ── Seen Registry (object permanence) ──
// Tracks every monster, item, and feature the player has ever observed
// during this game session. Used by the diff system to distinguish
// "first encounter" from "reappeared" so the LLM narrates appropriately.

/** Serializable state for the seen registry. */
export interface SeenRegistryData {
  /** Monster m_ids the player has observed. */
  monsterIds: number[];
  /** Species names ever seen (fallback when m_id isn't available). */
  monsterSpecies: string[];
  /** Item position keys (e.g. "dlvl1:scroll@57,13") ever seen on the floor. */
  items: string[];
  /** Feature position keys (e.g. "dlvl1:staircase up@46,16") ever seen. */
  features: string[];
}

export class SeenRegistry {
  private _monsterIds = new Set<number>();
  private _monsterSpecies = new Set<string>();
  private _items = new Set<string>();
  private _features = new Set<string>();

  /** Register a monster as seen. Returns true if this is the first time. */
  seeMonster(m_id: number | undefined, name: string): boolean {
    if (m_id) {
      if (this._monsterIds.has(m_id)) return false;
      this._monsterIds.add(m_id);
      this._monsterSpecies.add(name);
      return true;
    }
    // Fallback: species-level tracking when m_id unavailable
    if (this._monsterSpecies.has(name)) return false;
    this._monsterSpecies.add(name);
    return true;
  }

  /** Check if a monster has been seen before (without marking it). */
  hasSeenMonster(m_id: number | undefined, name: string): boolean {
    if (m_id) return this._monsterIds.has(m_id);
    return this._monsterSpecies.has(name);
  }

  /** Register a floor item as seen. Returns true if first time.
   *  `dlvl` scopes the key so identical positions on different levels
   *  don't collide. */
  seeItem(name: string, x: number, y: number, dlvl: number): boolean {
    const key = `dlvl${dlvl}:${name}@${x},${y}`;
    if (this._items.has(key)) return false;
    this._items.add(key);
    return true;
  }

  /** Register a map feature as seen. Returns true if first time.
   *  `featureKey` is the existing `name@x,y` string; `dlvl` scopes it
   *  per dungeon level. */
  seeFeature(featureKey: string, dlvl: number): boolean {
    const key = `dlvl${dlvl}:${featureKey}`;
    if (this._features.has(key)) return false;
    this._features.add(key);
    return true;
  }

  /** Serialize for persistence. */
  toJSON(): SeenRegistryData {
    return {
      monsterIds: [...this._monsterIds],
      monsterSpecies: [...this._monsterSpecies],
      items: [...this._items],
      features: [...this._features],
    };
  }

  /** Restore from persisted data. */
  static fromJSON(data: SeenRegistryData): SeenRegistry {
    const reg = new SeenRegistry();
    for (const id of data.monsterIds ?? []) reg._monsterIds.add(id);
    for (const sp of data.monsterSpecies ?? []) reg._monsterSpecies.add(sp);
    for (const it of data.items ?? []) reg._items.add(it);
    for (const ft of data.features ?? []) reg._features.add(ft);
    return reg;
  }
}

let lastTurnSnapshot: NarrationSnapshot | null = null;
let lastNarrationSnapshot: NarrationSnapshot | null = null;
let turnLog: TurnRecord[] = [];
export let seenRegistry = new SeenRegistry();

/** Reset narration state for a new game. Call alongside llmState.clearNarration(). */
export function resetNarrationState(): void {
  lastTurnSnapshot = null;
  lastNarrationSnapshot = null;
  turnLog = [];
  seenRegistry = new SeenRegistry();
  // Queue state — reset so a fresh game doesn't inherit an in-flight
  // flag from whatever the previous game was doing when it ended.
  narrationInFlight = false;
  pendingCoalesce = false;
  latestState = null;
}

// ── Per-slot narration persistence ──
// Narration entries (and the diff baseline so future aggregate diffs
// are computed from the right starting point) survive save/load so
// that resuming a game doesn't wipe the LLM's memory of what happened
// before. Schema version 2: the session-mode state (sessionMessages,
// lastSent) is no longer persisted since session mode was removed.

const NARRATION_STATE_PREFIX = 'nethack-narration-state-';
const NARRATION_STATE_VERSION = 3;

interface PersistedNarrationState {
  version: number;
  lastNarrationSnapshot: NarrationSnapshot | null;
  turnLog: TurnRecord[];
  entries: LLMEntry[];
  seenRegistry?: SeenRegistryData;
}

function narrationStateKey(slotId: string): string {
  return `${NARRATION_STATE_PREFIX}${slotId}`;
}

/** Persist narration state (entries log + turn log + diff baseline) for
 *  a save slot. */
export function saveNarrationStateForSlot(slotId: string): void {
  if (!slotId) return;
  try {
    const payload: PersistedNarrationState = {
      version: NARRATION_STATE_VERSION,
      lastNarrationSnapshot,
      turnLog,
      entries: llmState.entries,
      seenRegistry: seenRegistry.toJSON(),
    };
    localStorage.setItem(narrationStateKey(slotId), JSON.stringify(payload));
    console.log('[NARRATION PERSIST]', {
      slotId,
      entries: llmState.entries.length,
      turnLogSize: turnLog.length,
    });
  } catch (e) {
    console.warn('[NARRATION PERSIST] failed', e);
  }
}

/** Restore narration state for a save slot. Returns true if state was
 *  loaded. A schema version mismatch (e.g. a v1 payload from before
 *  session mode was removed) is silently ignored — the user loses
 *  narration continuity for that slot but not gameplay progress. */
export function loadNarrationStateForSlot(slotId: string): boolean {
  if (!slotId) return false;
  try {
    const raw = localStorage.getItem(narrationStateKey(slotId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as PersistedNarrationState;
    if (parsed.version !== NARRATION_STATE_VERSION) return false;
    lastNarrationSnapshot = parsed.lastNarrationSnapshot ?? null;
    turnLog = parsed.turnLog ?? [];
    lastTurnSnapshot = lastNarrationSnapshot; // seed single-turn diff from same baseline
    llmState.entries = parsed.entries ?? [];
    seenRegistry = parsed.seenRegistry
      ? SeenRegistry.fromJSON(parsed.seenRegistry)
      : new SeenRegistry();
    console.log('[NARRATION RESTORE]', {
      slotId,
      entries: llmState.entries.length,
      turnLogSize: turnLog.length,
    });
    return true;
  } catch (e) {
    console.warn('[NARRATION RESTORE] failed', e);
    return false;
  }
}

/** Delete persisted narration state for a save slot (on death/quit/delete). */
export function clearNarrationStateForSlot(slotId: string): void {
  if (!slotId) return;
  try {
    localStorage.removeItem(narrationStateKey(slotId));
  } catch { /* ignore */ }
}

/**
 * Regex patterns matching UI instruction messages that NetHack prints via
 * pline() (same path as game messages). Derived from the NetHack 3.7 source.
 */
const UI_INSTRUCTION_PATTERNS: RegExp[] = [
  // Position/cursor selection (getpos.c)
  /^Move cursor to /i,
  /^\(For instructions type a /i,
  /limiting targets/i,
  /a menu to show possible targets/i,
  /skipping over similar terrain/i,
  /^Unknown direction:/i,
  /^Can't find dungeon feature/i,
  /^Done\.$/,

  // Direction & destination prompts (cmd.c, apply.c, spell.c, teleport.c, read.c)
  /^In what direction\??$/i,
  /^Where do you want to /i,
  /^Where do .+ want to be teleported/i,

  // Item/monster selection (invent.c, wizcmds.c, pager.c)
  /^Pick (?:a |an )/i,
  /^Please move the cursor to /i,
  /^Choose an item/i,
  /^Select an inventory slot/i,
  /^Try again \(type /i,

  // Key binding (cmd.c)
  /^Bind which key/i,

  // Click instructions (cmd.c)
  /desired location, then type /i,
];

/** Filter out UI instruction messages, returning only real game messages. */
export function filterMessages(messages: string[], prompt?: string): string[] {
  const promptText = prompt?.trim();
  return messages.filter(msg => {
    const trimmed = msg.trim();
    if (!trimmed) return false;
    if (promptText && trimmed === promptText) return false;
    if (UI_INSTRUCTION_PATTERNS.some(p => p.test(trimmed))) return false;
    return true;
  });
}

function getLastNarration(): { text: string; turn: number } | null {
  for (let i = llmState.entries.length - 1; i >= 0; i--) {
    if (llmState.entries[i].kind === 'narration') {
      return llmState.entries[i];
    }
  }
  return null;
}

/**
 * Build a small ASCII map excerpt centered on the player, with entity markers
 * and a legend. Uses standard (x,y) coordinates where x=east, y=south.
 */
export function buildMiniMap(state: GameState): string {
  const px = state.player.x;
  const py = state.player.y;
  const map = state.map;
  if (!map || map.length === 0) return '';

  // Assign single-char labels to entities
  const labels = new Map<string, string>(); // "x,y" → display char
  const legend: string[] = [];

  // Player is always @
  labels.set(`${px},${py}`, '@');

  for (const e of state.entities) {
    const key = `${e.x},${e.y}`;
    if (key === `${px},${py}`) continue; // don't overwrite player
    if (labels.has(key)) continue; // first entity wins
    labels.set(key, e.char);
    const name = e.type === 'monster'
      ? `${e.name}${(e as MonsterEntity).pet ? ' (pet)' : ''}`
      : (e as ItemEntity).name || (e as ItemEntity).category;
    legend.push(`${e.char}=${name} at (${e.x},${e.y})`);
  }

  // Add door legend entries from terrain data (don't override map chars —
  // the ASCII map already shows the correct character for each door state).
  // Caveat: when the player is standing on a door tile, the rendered map
  // shows '@' there rather than the door glyph; substitute the canonical
  // door character so the legend doesn't claim `@ = open door`.
  if (state.terrain) {
    for (const exit of state.terrain.exits) {
      if (exit.type !== 'closed door' && exit.type !== 'open door') continue;
      const key = `${exit.x},${exit.y}`;
      const playerOnTile = exit.x === px && exit.y === py;
      // Skip if a non-player entity has already claimed this tile in
      // the labels map — but DON'T skip when the only "label" here is
      // the player's @, because we still need a door legend entry and
      // the player will eventually move off it.
      if (labels.has(key) && !playerOnTile) continue;
      const row = map[exit.y];
      let mapChar = row ? row[exit.x] : '+';
      if (playerOnTile || mapChar === '@') {
        mapChar = exit.type === 'open door' ? '/' : '+';
      }
      legend.push(`${mapChar}=${exit.type} at (${exit.x},${exit.y})`);
    }
  }

  // Full map with entity overlays — only 80x21, trivial for LLM context
  const lines: string[] = [];
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    let line = '';
    for (let x = 0; x < row.length; x++) {
      const override = labels.get(`${x},${y}`);
      line += override || row[x];
    }
    if (line.trim()) lines.push(line);
  }

  if (lines.length === 0) return '';

  let result = `Map (@ is you at (${px},${py}), x=east y=south):\n${lines.join('\n')}`;
  if (legend.length > 0) {
    result += `\nLegend: ${legend.join(', ')}`;
  }
  return result;
}

/** Non-pet monsters visible to the player, excluding the player themselves.
 *  wasm-connection adds the player as a monster entity (name "you") at the
 *  player's tile so MapDisplay can render it; we strip that here. */
function visibleMonsters(state: GameState): MonsterEntity[] {
  return state.entities.filter((e): e is MonsterEntity =>
    e.type === 'monster' && !e.pet
    && !(e.x === state.player.x && e.y === state.player.y));
}

/** Visible pets. */
function visiblePets(state: GameState): MonsterEntity[] {
  return state.entities.filter((e): e is MonsterEntity =>
    e.type === 'monster' && e.pet);
}

/** Visible floor items for narration, excluding terrain features that
 *  wasm-connection duplicates into `entities` for map/legend rendering. */
function visibleNarrationItems(state: GameState): ItemEntity[] {
  const featureKeys = new Set((state.terrain?.features ?? [])
    .map(f => `${f.name}@${f.x},${f.y}`));

  return state.entities.filter((e): e is ItemEntity => {
    if (e.type !== 'item') return false;
    const name = e.name || e.category;
    return !featureKeys.has(`${name}@${e.x},${e.y}`);
  });
}

function describeRelativePos(px: number, py: number, ex: number, ey: number): string {
  const dx = ex - px;
  const dy = ey - py;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return 'here';
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  const dir = `${ns}${ns && ew ? '-' : ''}${ew}`;
  if (dist === 1) return `adjacent ${dir}`;
  return `${dist} tiles ${dir}`;
}

function describeDiscovery(name: string, px: number, py: number, x: number, y: number): string {
  return `Discovered ${name} (${describeRelativePos(px, py, x, y)})`;
}

export function describeAction(action: Record<string, any> | null, px: number, py: number): string {
  if (!action) return '';
  switch (action.action) {
    case 'move':
      return `move ${action.direction}`;
    case 'farlook':
      return `look at ${action.description || 'something'} (${describeRelativePos(px, py, action.x, action.y)})`;
    case 'answer':
    case 'menuSelect':
    case 'menuDismiss':
      return ''; // prompt responses aren't worth narrating
    case 'key':
      return ''; // raw keystrokes without context aren't useful
    case 'direction':
      return `direction ${action.direction}`;
    default:
      // verb actions (eat, wield, etc.) and named actions (search, pray, etc.)
      if (action.direction) return `${action.action} ${action.direction}`;
      if (action.item) {
        const itemDesc = action.itemName
          ? `${action.item} (${action.itemName})`
          : action.item;
        return `${action.action} item ${itemDesc}`;
      }
      return action.action.replace(/_/g, ' ');
  }
}

export function describeActionContext(px: number, py: number): string {
  const ctx = gameState.actionContext;
  if (!ctx) return describeAction(gameState.lastAction, px, py);

  const base = describeAction(ctx.action, px, py);
  if (!base || ctx.prompts.length === 0) return base;

  const promptDescs = ctx.prompts.map(p => {
    let answerDesc = p.answer;
    if (p.type === 'yn') {
      answerDesc = p.answer === 'y' ? 'yes'
        : p.answer === 'n' ? 'no'
        : p.answer;
    }
    return `  → Prompted: "${p.query}" → answered ${answerDesc}`;
  });
  return `${base}\n${promptDescs.join('\n')}`;
}

export function captureSnapshot(state: GameState): NarrationSnapshot {
  return {
    turn: state.turn,
    px: state.player.x,
    py: state.player.y,
    dlvl: state.dlvl,
    hp: state.player.hp,
    maxHp: state.player.max_hp,
    pw: state.player.pw,
    maxPw: state.player.max_pw,
    hunger: state.player.hunger,
    conditions: [...state.conditions],
    properties: [...state.properties],
    warnedMonsters: [...state.warnedMonsters],
    monsters: visibleMonsters(state).map(e => ({ name: e.name, x: e.x, y: e.y, ...(e.m_id ? { m_id: e.m_id } : {}) })),
    pets: visiblePets(state).map(e => ({ name: e.name, x: e.x, y: e.y, ...(e.m_id ? { m_id: e.m_id } : {}) })),
    items: visibleNarrationItems(state).map(e => ({ name: e.name || e.category, x: e.x, y: e.y })),
    inventory: state.inventory.map(i => ({ letter: i.letter, text: i.text })),
    playerRoomNo: state.terrain?.playerRoom?.roomNo ?? null,
    playerInCorridor: state.terrain?.playerTerrain === 'CORR',
    playerLit: state.terrain?.playerLit ?? false,
    featureKeys: (state.terrain?.features ?? []).map(f => `${f.name}@${f.x},${f.y}`),
    visibleFloorTiles: state.terrain?.visibleFloorTiles ?? 0,
  };
}

interface CreaturePos { name: string; x: number; y: number; m_id?: number; }

/**
 * Diff two lists of creatures (monsters or pets), emitting appear / move /
 * disappear lines. Uses greedy nearest-neighbor matching per-name so
 * duplicates (e.g. two grid bugs) are paired correctly regardless of order,
 * and reports every movement — not just "closer" / "further" by ≥ 2 tiles.
 *
 * Movement lines describe both the relative motion (closer/further/shifted)
 * and the absolute new position, so the LLM always knows where the creature
 * is right now.
 */
function diffCreatures(
  prev: CreaturePos[],
  curr: CreaturePos[],
  px: number,
  py: number,
  appeared: (name: string, pos: CreaturePos) => string,
  moved: (name: string, motion: string, pos: CreaturePos) => string,
  gone: (name: string) => string,
  out: string[],
): void {
  // Bucket by name so multiple creatures with the same species don't
  // collide via a name-keyed Map (the old bug).
  const prevByName = new Map<string, CreaturePos[]>();
  for (const p of prev) {
    const list = prevByName.get(p.name);
    if (list) list.push({ ...p });
    else prevByName.set(p.name, [{ ...p }]);
  }

  // For each current creature, find the closest previous entry with the
  // same name (Chebyshev distance). If found, it's the same creature that
  // moved; otherwise it appeared this turn. A distance cap of 8 prevents
  // pairing a creature that actually left sight with an unrelated new one
  // that happens to share a name on the other side of the map.
  const MATCH_MAX_DIST = 8;
  for (const c of curr) {
    const candidates = prevByName.get(c.name);
    if (!candidates || candidates.length === 0) {
      out.push(appeared(c.name, c));
      continue;
    }
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const d = Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > MATCH_MAX_DIST) {
      out.push(appeared(c.name, c));
      continue;
    }
    const old = candidates[bestIdx];
    candidates.splice(bestIdx, 1);
    if (old.x === c.x && old.y === c.y) continue; // didn't move

    const oldPlayerDist = Math.max(Math.abs(old.x - px), Math.abs(old.y - py));
    const newPlayerDist = Math.max(Math.abs(c.x - px), Math.abs(c.y - py));
    let motion: string;
    if (newPlayerDist < oldPlayerDist) motion = 'moved closer';
    else if (newPlayerDist > oldPlayerDist) motion = 'moved away';
    else motion = 'shifted';
    out.push(moved(c.name, motion, c));
  }

  // Anything left in prev didn't match a current creature → gone from view.
  for (const list of prevByName.values()) {
    for (const p of list) {
      out.push(gone(p.name));
    }
  }
}

/** Pet diff specialized for crossing a dungeon level boundary. Matches
 *  by name alone (no Chebyshev cap — different levels have different
 *  coordinate spaces, so the normal position-based matching would emit
 *  spurious "appeared" + "is no longer visible" pairs for a pet that
 *  simply followed the player through the stairs). Emits "followed you"
 *  for pets present in both prev and curr, "did not follow you" for
 *  pets only in prev, and "appeared" for pets only in curr (rare but
 *  possible, e.g. a tame creature encountered on the new level). */
function diffPetsAcrossLevelChange(
  prev: CreaturePos[],
  curr: CreaturePos[],
  px: number,
  py: number,
  out: string[],
): void {
  const prevByName = new Map<string, CreaturePos[]>();
  for (const p of prev) {
    const list = prevByName.get(p.name);
    if (list) list.push(p);
    else prevByName.set(p.name, [p]);
  }

  for (const c of curr) {
    const candidates = prevByName.get(c.name);
    if (candidates && candidates.length > 0) {
      candidates.shift(); // consume one so duplicate-name pets pair off correctly
      out.push(`Your pet ${c.name} followed you (now ${describeRelativePos(px, py, c.x, c.y)})`);
    } else {
      out.push(`Your pet ${c.name} appeared (${describeRelativePos(px, py, c.x, c.y)})`);
    }
  }

  for (const list of prevByName.values()) {
    for (const p of list) {
      out.push(`Your pet ${p.name} did not follow you`);
    }
  }
}

export function computeDiff(prev: NarrationSnapshot, state: GameState): string[] {
  const current = captureSnapshot(state);
  const px = state.player.x;
  const py = state.player.y;
  const lines: string[] = [];

  // Crossing a dungeon level boundary means `prev` and `current` are in
  // different coordinate spaces. Anything that compares tile positions
  // between them (player "Moved", monster/item/feature appear/disappear
  // diffing, room/corridor transitions, lighting change) is meaningless
  // across this gate — we suppress those and let the "Descended/Ascended"
  // line plus the fresh CURRENT STATE block speak for the new level.
  const levelChanged = current.dlvl !== prev.dlvl;

  // Turn consumed
  if (current.turn > prev.turn) {
    const delta = current.turn - prev.turn;
    lines.push(delta === 1 ? 'Turn advanced' : `${delta} turns advanced`);
  }

  // Player moved — only meaningful within the same level. A stair
  // descent or ascent changes (px, py) but that's teleportation into
  // a different coordinate space, not locomotion; the "Descended/
  // Ascended" line below captures it.
  if (!levelChanged && (current.px !== prev.px || current.py !== prev.py)) {
    const dx = current.px - prev.px;
    const dy = current.py - prev.py;
    const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
    const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
    const dir = `${ns}${ns && ew ? '-' : ''}${ew}` || 'in place';
    lines.push(`Moved ${dir}`);
  }

  // Dungeon level
  if (levelChanged) {
    const verb = current.dlvl > prev.dlvl ? 'Descended' : 'Ascended';
    lines.push(`${verb} to dungeon level ${current.dlvl}`);
  }

  // HP
  const hpDelta = current.hp - prev.hp;
  if (hpDelta !== 0) {
    const verb = hpDelta < 0 ? 'Lost' : 'Gained';
    lines.push(`${verb} ${Math.abs(hpDelta)} HP (now ${current.hp}/${current.maxHp})`);
  }

  // Power
  const pwDelta = current.pw - prev.pw;
  if (pwDelta !== 0) {
    const verb = pwDelta < 0 ? 'Lost' : 'Gained';
    lines.push(`${verb} ${Math.abs(pwDelta)} power (now ${current.pw}/${current.maxPw})`);
  }

  // Hunger
  if (current.hunger !== prev.hunger) {
    lines.push(`Hunger: ${prev.hunger} → ${current.hunger}`);
  }

  // Conditions — translate to friendly display names so the diff reads
  // naturally ("Now flying" instead of "Now fly", "No longer levitating"
  // instead of "No longer lev").
  const prevConds = new Set(prev.conditions);
  const currConds = new Set(current.conditions);
  for (const c of currConds) {
    if (!prevConds.has(c)) lines.push(`Now ${friendlyConditionName(c)}`);
  }
  for (const c of prevConds) {
    if (!currConds.has(c)) lines.push(`No longer ${friendlyConditionName(c)}`);
  }

  // Properties — only diff non-condition-overlap properties to avoid
  // duplicating the condition diff lines above.
  const prevProps = new Set(prev.properties);
  const currProps = new Set(current.properties);
  for (const p of currProps) {
    if (!prevProps.has(p) && !CONDITION_OVERLAP_PROPERTIES.has(p)) {
      lines.push(`Gained ${friendlyPropertyName(p, current.warnedMonsters)}`);
    }
  }
  for (const p of prevProps) {
    if (!currProps.has(p) && !CONDITION_OVERLAP_PROPERTIES.has(p)) {
      lines.push(`Lost ${friendlyPropertyName(p, prev.warnedMonsters)}`);
    }
  }

  // Monsters — within-level only. On a level change, the old level's
  // monsters were left behind and the new level's are unique to the
  // new level. The CURRENT STATE block renders those to the LLM; the
  // diff only needs to say "you descended." Per-monster appear/gone
  // lines across the transition would be noise at best and contradict
  // the "descended" beat at worst.
  if (!levelChanged) {
    diffCreatures(
      prev.monsters, current.monsters, px, py,
      (name, pos) => {
        const firstTime = seenRegistry.seeMonster(pos.m_id, name);
        const rel = describeRelativePos(px, py, pos.x, pos.y);
        return firstTime
          ? `A ${name} is here for the first time (${rel})`
          : `A ${name} reappeared (${rel})`;
      },
      (name, motion, pos) => `The ${name} ${motion} (now ${describeRelativePos(px, py, pos.x, pos.y)})`,
      (name) => `The ${name} is no longer visible`,
      lines,
    );
    // Register monsters that were already visible (matched in prev,
    // not emitted as "appeared") so they're tracked going forward.
    for (const c of current.monsters) {
      seenRegistry.seeMonster(c.m_id, c.name);
    }
  }

  // Pets — within-level uses the normal position-matching path. On a
  // level change we can't compare positions (different coordinate
  // spaces), so match by name alone to detect which pets followed the
  // player through the stairs. Emits "followed you" instead of
  // "appeared" + "is no longer visible" (which is what the old
  // position-based matching produced when the Chebyshev distance
  // exceeded MATCH_MAX_DIST across the level boundary).
  if (levelChanged) {
    diffPetsAcrossLevelChange(prev.pets, current.pets, px, py, lines);
  } else {
    diffCreatures(
      prev.pets, current.pets, px, py,
      (name, pos) => {
        const firstTime = seenRegistry.seeMonster(pos.m_id, name);
        const rel = describeRelativePos(px, py, pos.x, pos.y);
        return firstTime
          ? `Your pet ${name} appeared for the first time (${rel})`
          : `Your pet ${name} reappeared (${rel})`;
      },
      (name, motion, pos) => `Your pet ${name} ${motion} (now ${describeRelativePos(px, py, pos.x, pos.y)})`,
      (name) => `Your pet ${name} is no longer visible`,
      lines,
    );
  }
  // Register all currently visible pets regardless of path
  for (const c of current.pets) {
    seenRegistry.seeMonster(c.m_id, c.name);
  }

  // Items — within-level only. Same reasoning as monsters: items on
  // the old level aren't "gone" (they're still there, you just left),
  // and items on the new level aren't "discoveries" in the diff sense
  // (they're unrelated to the old level's item list).
  if (!levelChanged) {
    const prevItems = new Map(prev.items.map(i => [`${i.name}@${i.x},${i.y}`, i]));
    const currItems = new Map(current.items.map(i => [`${i.name}@${i.x},${i.y}`, i]));
    for (const [key, item] of currItems) {
      if (!prevItems.has(key)) {
        const firstTime = seenRegistry.seeItem(item.name, item.x, item.y, current.dlvl);
        lines.push(firstTime
          ? `Discovered ${item.name} (${describeRelativePos(px, py, item.x, item.y)}) [new]`
          : `${item.name} visible again (${describeRelativePos(px, py, item.x, item.y)})`);
      }
    }
    // Register all currently visible items
    for (const item of current.items) {
      seenRegistry.seeItem(item.name, item.x, item.y, current.dlvl);
    }
    for (const [key, item] of prevItems) {
      if (!currItems.has(key)) {
        lines.push(`The ${item.name} is no longer on the floor nearby`);
      }
    }
  }

  // Inventory changes
  const prevInv = new Map(prev.inventory.map(i => [i.letter, i.text]));
  const currInv = new Map(current.inventory.map(i => [i.letter, i.text]));
  for (const [letter, text] of currInv) {
    const prevText = prevInv.get(letter);
    if (prevText === undefined) {
      lines.push(`Gained inventory ${letter}: ${text}`);
    } else if (prevText !== text) {
      lines.push(`Inventory ${letter}: ${prevText} → ${text}`);
    }
  }
  for (const [letter, text] of prevInv) {
    if (!currInv.has(letter)) {
      lines.push(`Lost inventory ${letter}: ${text}`);
    }
  }

  // Terrain transitions — within-level only. "Entered a room" /
  // "Entered a corridor" / "Moved to a different room" all compare
  // room numbers and corridor state between prev and curr, which is
  // only meaningful inside the same level's coordinate space.
  if (!levelChanged) {
    if (current.playerInCorridor && !prev.playerInCorridor) {
      lines.push('Entered a corridor');
    } else if (!current.playerInCorridor && prev.playerInCorridor && current.playerRoomNo !== null) {
      const terrain = state.terrain;
      if (terrain?.playerRoom) {
        const r = terrain.playerRoom;
        lines.push(`Entered a ${r.lit ? 'lit' : 'dark'} room (${r.width}x${r.height})`);
      } else {
        lines.push('Entered a room');
      }
    } else if (current.playerRoomNo !== null && prev.playerRoomNo !== null
      && current.playerRoomNo !== prev.playerRoomNo) {
      lines.push('Moved to a different room');
    }
  }

  // Lighting change — within-level only. Across a level transition,
  // the fact that the new level's first room happens to be dark or lit
  // is not a "change" — it's just the initial state of the new level,
  // which the CURRENT STATE block already describes.
  if (!levelChanged && current.playerLit !== prev.playerLit) {
    lines.push(current.playerLit ? 'Area is now lit' : 'Area is now dark');
  }

  // New features discovered — within-level only. Features on the new
  // level aren't "discoveries" relative to the old level's feature set;
  // they're just what this level looks like. featureKeys embed
  // coordinates so the cross-level set diff would flag everything.
  if (!levelChanged) {
    const prevFeatureSet = new Set(prev.featureKeys);
    for (const key of current.featureKeys) {
      if (!prevFeatureSet.has(key)) {
        const [name, coords] = key.split('@');
        const [x, y] = coords.split(',').map(Number);
        const firstTime = seenRegistry.seeFeature(key, current.dlvl);
        lines.push(firstTime
          ? `Discovered ${name} (${describeRelativePos(px, py, x, y)}) [new]`
          : `${name} visible again (${describeRelativePos(px, py, x, y)})`);
      }
    }
    // Register all currently visible features
    for (const key of current.featureKeys) {
      seenRegistry.seeFeature(key, current.dlvl);
    }
  }

  // On level change, register all entities on the new level so they're
  // tracked even though we skip the within-level diff.
  if (levelChanged) {
    for (const c of current.monsters) seenRegistry.seeMonster(c.m_id, c.name);
    for (const c of current.pets) seenRegistry.seeMonster(c.m_id, c.name);
    for (const item of current.items) seenRegistry.seeItem(item.name, item.x, item.y, current.dlvl);
    for (const key of current.featureKeys) seenRegistry.seeFeature(key, current.dlvl);
  }

  return lines;
}

function formatTurnLog(log: TurnRecord[]): string {
  if (log.length === 0) return '';

  // Single turn: same format as before
  if (log.length === 1) {
    const entry = log[0];
    const actionText = entry.action ? `\nPlayer action: ${entry.action}\n` : '';
    const diffText = entry.diff.length > 0
      ? `\nWhat changed this turn:\n${entry.diff.map(l => `- ${l}`).join('\n')}\n`
      : '';
    return `${actionText}${diffText}`;
  }

  // Multiple turns: step-by-step log
  const lines: string[] = [`\nActions since last narration (${log.length} turns):`];
  for (const entry of log) {
    const actionLine = entry.action || '(no action)';
    lines.push(`  Turn ${entry.turn}: ${actionLine}`);
    for (const d of entry.diff) {
      lines.push(`    - ${d}`);
    }
    if (entry.messages.length > 0) {
      lines.push(`    Messages: ${entry.messages.join(' ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

type CreatureVisibilityKind = 'appeared' | 'gone';

interface CreatureVisibilityEvent {
  key: string;
  kind: CreatureVisibilityKind;
}

function parseCreatureVisibilityLine(line: string): CreatureVisibilityEvent | null {
  // Match both old "appeared" and new "is here for the first time" / "reappeared"
  let m = /^A (.+) (?:is here for the first time|reappeared) \(/.exec(line);
  if (m) return { key: `monster:${m[1]}`, kind: 'appeared' };

  m = /^The (.+) is no longer visible$/.exec(line);
  if (m) return { key: `monster:${m[1]}`, kind: 'gone' };

  m = /^Your pet (.+) (?:appeared for the first time|reappeared) \(/.exec(line);
  if (m) return { key: `pet:${m[1]}`, kind: 'appeared' };

  m = /^Your pet (.+) is no longer visible$/.exec(line);
  if (m) return { key: `pet:${m[1]}`, kind: 'gone' };

  return null;
}

function normalizeAggregatedDiff(
  aggregatedDiff: string[],
  log: TurnRecord[],
  state: GameState,
): string[] {
  const visibilityCounts = new Map<string, { appeared: number; gone: number }>();
  for (const line of aggregatedDiff) {
    const parsed = parseCreatureVisibilityLine(line);
    if (!parsed) continue;
    const counts = visibilityCounts.get(parsed.key) ?? { appeared: 0, gone: 0 };
    counts[parsed.kind] += 1;
    visibilityCounts.set(parsed.key, counts);
  }

  const latestVisibilityByKey = new Map<string, CreatureVisibilityKind>();
  for (const entry of log) {
    for (const line of entry.diff) {
      const parsed = parseCreatureVisibilityLine(line);
      if (parsed) latestVisibilityByKey.set(parsed.key, parsed.kind);
    }
  }

  const currentlyVisible = new Set<string>([
    ...visibleMonsters(state).map(m => `monster:${m.name}`),
    ...visiblePets(state).map(p => `pet:${p.name}`),
  ]);

  return aggregatedDiff.filter(line => {
    const parsed = parseCreatureVisibilityLine(line);
    if (!parsed) return true;

    const counts = visibilityCounts.get(parsed.key);
    if (!counts || counts.appeared === 0 || counts.gone === 0) return true;

    const desired = latestVisibilityByKey.get(parsed.key)
      ?? (currentlyVisible.has(parsed.key) ? 'appeared' : 'gone');
    return parsed.kind === desired;
  });
}

/**
 * Build the unified narration prompt. Assembles the system instructions,
 * recent narration history (for tonal continuity), authoritative current
 * state block (for Category 1 correctness — flying/hungry/equipped/etc.),
 * the current turn's log + messages, and the mini-map.
 *
 * `opts.isGameStart` swaps the system instructions to ask for an
 * atmospheric opening narration and adds the intro lore text from
 * gameState.introText if present.
 */
function buildNarrationPrompt(
  state: GameState,
  log: TurnRecord[],
  aggregatedDiff: string[],
  opts: { isGameStart?: boolean } = {},
): string {
  const isGameStart = !!opts.isGameStart;
  const system = buildSystemInstructions(isGameStart);
  const history = formatNarrationHistory(llmState.entries);
  const stateBlock = buildCurrentStateBlock(state);
  const turnBlock = buildThisTurnBlock(state, log, aggregatedDiff);
  const map = buildMiniMap(state);

  const introLore = isGameStart && gameState.introText.length > 0
    ? `\nIntro lore text:\n${gameState.introText.join('\n')}\n`
    : '';

  // Omit the history section entirely when empty so the prompt doesn't
  // have a dangling "RECENT NARRATION HISTORY" header with nothing under it.
  const historySection = history ? `${history}\n\n` : '';
  const closing = isGameStart
    ? 'Write the opening narration:'
    : 'Narrate what just happened:';

  return `${system}

${historySection}${stateBlock}

${turnBlock}

${map}
${introLore}
${closing}`;
}

// ─── Unified prompt builder helpers ─────────────────────────────────
// These compose into the new buildNarrationPrompt. Each is a pure
// function of its inputs so they can be unit-tested in isolation.

/** Render the system/persona block that sits at the top of every prompt.
 *  `isGameStart` swaps the instructions to ask for an atmospheric opener
 *  instead of a per-turn continuation. */
export function buildSystemInstructions(isGameStart: boolean): string {
  // FORMATTING RULES — apply to BOTH variants. The narration is rendered
  // as continuous prose in an in-game story panel; markdown headers /
  // section breaks / titles would appear literally as `# Some Title`
  // text mid-story and break the reading experience. Bold and italic
  // formatting via standard markdown (* and _) is fine in moderation
  // for emphasis, but no headers, lists, or block quotes.
  const formattingRules = `OUTPUT FORMAT RULES (strict):
- Do NOT use markdown headers (#, ##, ###, etc.) — never title your narrations.
- Do NOT prefix narrations with a title, label, scene name, or "Chapter" marker.
- Do NOT use bullet lists, numbered lists, or block quotes.
- Do NOT use horizontal rules (---) or section breaks of any kind.
- Light *italic* or **bold** for in-line emphasis is acceptable but optional.
- Output ONLY the prose narration itself — start directly with the first sentence, no preamble.`;

  if (isGameStart) {
    return `You are a dramatic narrator for a game of NetHack, the classic roguelike dungeon crawler. Always use second person ("you") to refer to the player.
Write the OPENING NARRATION for this new adventure as the start of a fantasy novel. Introduce the adventurer and their companion (if any) as they descend into the Mazes of Menace seeking the Amulet of Yendor, and weave in their first impressions of their surroundings from the game data below. Use paragraph breaks as you see fit.
ONLY describe things present in the data below. Do NOT invent creatures, characters, or details that aren't listed.

${formattingRules}`;
  }
  return `You are a dramatic narrator for a game of NetHack, the classic roguelike dungeon crawler. Always use second person ("you") to refer to the player.
Narrate what just happened in 1-3 vivid sentences. Be atmospheric and dramatic, but concise.
Do not give advice or strategy. Just narrate the action.
ONLY describe things present in the data below. Do NOT invent creatures, characters, or details that aren't listed.
The RECENT NARRATION HISTORY section shows your prior narrations in this adventure; use them to maintain tonal continuity and reference recent events naturally, but do not repeat or rephrase them.
The CURRENT STATE section is authoritative for things like equipment, active effects (flying, hungry, cursed, etc.), and what's visible to you right now — trust it over anything remembered from older narrations.
In the WHAT CHANGED section, entities marked "for the first time" or "[new]" have NEVER been seen before in this adventure — narrate them as genuine first encounters. Entities marked "reappeared" or "visible again" HAVE been seen previously — acknowledge them briefly or skip them in favor of more narratively interesting events. Prioritize: (a) major player actions and their direct results, (b) room/level transitions and new environments, (c) first-time discoveries. Distant passive creatures are low priority unless they pose immediate threat.

${formattingRules}`;
}

/** Format a single past narration entry as it should appear in the
 *  RECENT NARRATION HISTORY block. Uses the stored header if present
 *  (new-style entries), falls back to just `[T{turn}]` for legacy
 *  entries persisted before headers existed. */
export function formatNarrationHistoryEntry(entry: LLMEntry): string {
  const h = entry.header;
  let prefix: string;
  if (h) {
    const parts = [`T${entry.turn}`, `dlvl ${h.dlvl}`, `HP ${h.hp}/${h.maxHp}`];
    if (h.conditions.length > 0) {
      parts.push(...friendlyConditionList(h.conditions));
    }
    // Include non-overlapping properties (legacy entries may lack this)
    const hProps = h.properties ?? [];
    if (hProps.length > 0) {
      const displayProps = friendlyPropertyList(hProps);
      if (displayProps.length > 0) parts.push(...displayProps);
    }
    const header = `[${parts.join(', ')}]`;
    prefix = h.action ? `${header} ${h.action}` : header;
  } else {
    prefix = `[T${entry.turn}]`;
  }
  // Narration text can span multiple lines; indent with "> " so the
  // LLM reads it as a distinct block rather than as continuation of
  // the header line.
  const quoted = entry.text.split('\n').map(l => `> ${l}`).join('\n');
  return `${prefix}\n${quoted}`;
}

/** Build the RECENT NARRATION HISTORY block from the entries list.
 *  Takes the last `limit` narration entries, oldest first. Returns an
 *  empty string if there are no past narrations (first turn of the game
 *  or freshly reset narration state). */
export function formatNarrationHistory(
  entries: LLMEntry[],
  limit: number = NARRATION_HISTORY_LIMIT,
): string {
  const narrations = entries.filter(e => e.kind === 'narration');
  if (narrations.length === 0) return '';
  const window = narrations.slice(-limit);
  const body = window.map(formatNarrationHistoryEntry).join('\n\n');
  return `RECENT NARRATION HISTORY (oldest first, for tonal continuity — do NOT repeat these):\n${body}`;
}

/** Build the authoritative CURRENT STATE block. This is the layer that
 *  makes persistent state changes (flying, hungry, equipped, location,
 *  etc.) reliable regardless of narration memory — the narrator can
 *  always see what's true *right now* by reading this section, and
 *  doesn't have to remember when the player put on the ring of flight
 *  80 turns ago.
 *
 *  Every field here should be derivable from the current game state
 *  alone. If something belongs here and isn't in the block yet, that's
 *  a silent memory hole — add it. */
export function buildCurrentStateBlock(state: GameState): string {
  const p = state.player;
  const identity = [state.alignment, state.gender, state.race, state.role]
    .filter(Boolean).join(' ');
  const characterLine = `Character: ${state.name_title}${identity ? ` (${identity})` : ''}`;
  const statsLine = `HP: ${p.hp}/${p.max_hp}, Power: ${p.pw}/${p.max_pw}, AC ${p.ac}, XP level ${p.xp_level} (${p.xp} xp), Gold: ${p.gold}, Score: ${p.score}`;
  const abilitiesLine = `Abilities: Str ${p.str}, Dex ${p.dex}, Con ${p.con}, Int ${p.int}, Wis ${p.wis}, Cha ${p.cha}`;
  const hungerLine = `Hunger: ${p.hunger}`;
  const effectsLine = `Active effects: ${state.conditions.length > 0 ? friendlyConditionList(state.conditions).join(', ') : 'none'}`;
  const displayProps = friendlyPropertyList(state.properties, state.warnedMonsters);
  const propertiesLine = `Active properties: ${displayProps.length > 0 ? displayProps.join(', ') : 'none'}`;

  const locationLine = `Location: Dungeon level ${state.dlvl}`;
  const terrainDesc = state.terrain
    ? formatTerrainForPrompt(state.terrain, p.x, p.y)
    : 'unknown';
  const surroundingsLine = `Surroundings: ${terrainDesc}`;

  const equipped = state.inventory.filter(i => i.worn);
  const equippedBlock = equipped.length > 0
    ? `Equipped:\n${equipped.map(i => `  - ${i.text}`).join('\n')}`
    : `Equipped: (nothing)`;

  const petsList = visiblePets(state);
  const petsBlock = petsList.length > 0
    ? `Pets:\n${petsList.map(e => `  - ${e.name} (${describeRelativePos(p.x, p.y, e.x, e.y)})`).join('\n')}`
    : `Pets: (none visible)`;

  const monstersList = visibleMonsters(state);
  const monstersBlock = monstersList.length > 0
    ? `Nearby creatures:\n${monstersList.map(e => `  - ${e.name} (${describeRelativePos(p.x, p.y, e.x, e.y)})`).join('\n')}`
    : `Nearby creatures: (none visible)`;

  const itemsList = visibleNarrationItems(state);
  const itemsBlock = itemsList.length > 0
    ? `Items on the floor nearby:\n${itemsList.map(e => `  - ${e.name || e.category} (${describeRelativePos(p.x, p.y, e.x, e.y)})`).join('\n')}`
    : `Items on the floor nearby: (none visible)`;

  const inventoryBlock = state.inventory.length > 0
    ? `Inventory:\n${state.inventory.map(i => `  ${i.letter}) ${i.text}`).join('\n')}`
    : `Inventory: (empty)`;

  return `CURRENT STATE
${characterLine}
${statsLine}
${abilitiesLine}
${hungerLine}
${effectsLine}
${propertiesLine}

${locationLine}
${surroundingsLine}

${equippedBlock}

${petsBlock}

${monstersBlock}

${itemsBlock}

${inventoryBlock}`;
}

/** Build the THIS TURN block describing what changed since the last
 *  narration. Reuses `formatTurnLog` for the per-turn log format and
 *  appends the aggregated diff when narration is covering multiple turns. */
export function buildThisTurnBlock(
  state: GameState,
  log: TurnRecord[],
  aggregatedDiff: string[],
): string {
  const normalizedAggregatedDiff = normalizeAggregatedDiff(aggregatedDiff, log, state);
  const turnLogSection = formatTurnLog(log).trim();
  const aggregatedSection = log.length > 1 && normalizedAggregatedDiff.length > 0
    ? `\nNet changes since last narration:\n${normalizedAggregatedDiff.map(l => `- ${l}`).join('\n')}`
    : '';
  const recentMessages = filterMessages(state.messages, state.prompt).join('\n');
  const messagesSection = `\nGame messages:\n${recentMessages || '(no messages)'}`;
  return `THIS TURN\n${turnLogSection}${aggregatedSection}${messagesSection}`;
}

/** Capture the narration header for an entry at the moment it's about
 *  to be stored. Reads live action context from `gameState` to describe
 *  the triggering action; the rest comes from the passed state. */
export function captureNarrationHeader(state: GameState): NarrationHeader {
  return {
    dlvl: state.dlvl,
    hp: state.player.hp,
    maxHp: state.player.max_hp,
    conditions: [...state.conditions],
    properties: [...state.properties],
    action: describeActionContext(state.player.x, state.player.y),
  };
}

function buildAnalysisPrompt(state: GameState): string {
  const inventoryText = state.inventory
    .map(i => `  ${i.letter}) ${i.text}`)
    .join('\n');
  const entityText = state.entities
    .map(e => {
      if (e.type === 'monster') return `  ${e.name}${e.pet ? ' (pet)' : ''} at (${e.x},${e.y})`;
      return `  ${(e as any).category}${(e as any).name ? ': ' + (e as any).name : ''} at (${e.x},${e.y})`;
    })
    .join('\n');

  return `You are a knowledgeable NetHack assistant helping a player understand their situation. Write in plain, natural language — short paragraphs, no bullet points or lists. Be concise and high-signal: explain what matters right now, what nearby things are, and what they should probably do next. Briefly explain any NetHack-specific concepts the player might not know. Don't be overly enthusiastic or use filler — just be clear and helpful.

${state.awaiting_input && state.prompt ? `The game is currently prompting them: "${state.prompt}". Explain what this means and how to respond.\n` : ''}
Here's their current situation:

${state.name_title} (${[state.alignment, state.gender, state.race, state.role].filter(Boolean).join(' ')}) — Dungeon level ${state.dlvl}, turn ${state.turn}
HP: ${state.player.hp}/${state.player.max_hp} | Power: ${state.player.pw}/${state.player.max_pw} | AC: ${state.player.ac}
XP level ${state.player.xp_level} | Gold: ${state.player.gold} | Hunger: ${state.player.hunger}
${state.conditions.length > 0 ? `Conditions: ${friendlyConditionList(state.conditions).join(', ')}` : ''}
${(() => { const dp = friendlyPropertyList(state.properties, state.warnedMonsters); return dp.length > 0 ? `Properties: ${dp.join(', ')}` : ''; })()}

Surroundings: ${state.terrain ? formatTerrainForPrompt(state.terrain, state.player.x, state.player.y) : 'unknown'}

Inventory:
${inventoryText || '  (empty)'}

Nearby:
${entityText || '  (nothing visible)'}

${buildMiniMap(state)}

Recent messages: ${state.messages.join(' ') || '(none)'}`;
}

/**
 * Lazy-load the provider SDK and return a LanguageModel instance.
 * Dynamic imports keep the initial bundle small — only the active provider is loaded.
 */
async function getModel(provider: string, model: string, apiKey: string): Promise<any> {
  switch (provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const client = createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return client(model);
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(model);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey })(model);
    }
    case 'groq': {
      const { createGroq } = await import('@ai-sdk/groq');
      return createGroq({ apiKey })(model);
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai');
      return createXai({ apiKey })(model);
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      return createDeepSeek({ apiKey })(model);
    }
    case 'ollama': {
      const { createOllama } = await import('ollama-ai-provider-v2');
      return createOllama({ baseURL: 'http://localhost:11434/api' })(model);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function callLLM(prompt: string, model: string, onChunk: (chunk: string) => void, think = false, maxTokens?: number): Promise<string> {
  if (llmState.provider === 'none') {
    const placeholder = '[debug: LLM call skipped]';
    onChunk(placeholder);
    return placeholder;
  }

  const { streamText } = await import('ai');
  const modelInstance = await getModel(llmState.provider, model, llmState.apiKey);

  const providerOptions: Record<string, any> = {};
  if (think && llmState.provider === 'anthropic') {
    providerOptions.anthropic = { thinking: { type: 'enabled', budgetTokens: 8000 } };
  } else if (think && llmState.provider === 'openai') {
    providerOptions.openai = { reasoningEffort: 'medium' };
  }

  const thinkingWithAnthropic = think && llmState.provider === 'anthropic';
  const result = streamText({
    model: modelInstance,
    prompt,
    maxOutputTokens: maxTokens ?? (think ? 1500 : 300),
    ...(thinkingWithAnthropic ? {} : { temperature: think ? 1 : 0.8 }),
    providerOptions,
    onError: ({ error }) => {
      console.error('[LLM STREAM ERROR]', error);
    },
  });

  let fullText = '';
  for await (const chunk of result.textStream) {
    fullText += chunk;
    onChunk(chunk);
  }
  // Awaiting result.text surfaces any mid-stream errors
  await result.text;
  return fullText;
}

/** Generate narration for the current turn.
 *
 *  Note: this function no longer guards on `llmState.isGenerating` for
 *  concurrency — the `runNarrationLoop` queue is now the only thing
 *  that should call this from the production path, and it serializes
 *  calls structurally. Tests still call `narrate` directly and always
 *  `await` the result, so the lack of a re-entrancy guard is safe.
 *  The `isGenerating` flag is still set/cleared for UI purposes. */
export async function narrate(state: GameState, log: TurnRecord[] = [], aggregatedDiff: string[] = []): Promise<void> {
  if (!llmState.isConfigured) return;

  llmState.isGenerating = true;
  llmState.currentNarration = '';

  try {
    const isGameStart = getLastNarration() === null && gameState.introText.length > 0;
    const maxTokens = isGameStart ? 1000 : undefined;

    // Unified builder with comprehensive state block and a rolling
    // narration history window. Stateless call — each invocation is
    // independent, which is what lets the queue in runNarrationLoop
    // trivially serialize and coalesce them.
    const prompt = buildNarrationPrompt(state, log, aggregatedDiff, { isGameStart });
    console.log('[NARRATION PROMPT]', prompt);
    const fullText = await callLLM(prompt, llmState.narratorModel, (chunk) => {
      llmState.currentNarration += chunk;
    }, false, maxTokens);

    llmState.entries = [
      ...llmState.entries,
      {
        kind: 'narration',
        turn: state.turn,
        text: fullText,
        timestamp: Date.now(),
        header: captureNarrationHeader(state),
      },
    ];
  } catch (err: any) {
    llmState.currentNarration = `[Narration error: ${err.message || err}]`;
  } finally {
    llmState.isGenerating = false;
  }
}

/** Generate on-demand analysis/advice */
export async function analyze(state: GameState): Promise<void> {
  if (llmState.isAnalyzing || !llmState.isConfigured) return;

  llmState.isAnalyzing = true;
  llmState.analysisResult = '';

  try {
    const prompt = buildAnalysisPrompt(state);
    console.log('[ANALYSIS PROMPT]', prompt);
    const fullText = await callLLM(prompt, llmState.analysisModel, (chunk) => {
      llmState.analysisResult += chunk;
    }, true);

    llmState.entries = [
      ...llmState.entries,
      { kind: 'analysis', turn: state.turn, text: fullText, timestamp: Date.now() },
    ];
  } catch (err: any) {
    llmState.analysisResult = `[Analysis error: ${err.message || err}]`;
  } finally {
    llmState.isAnalyzing = false;
  }
}

/**
 * Determine whether a state update has narration-worthy messages,
 * filtering out UI instruction messages and prompt echoes.
 */
export function hasNarratableContent(state: GameState): boolean {
  return filterMessages(state.messages, state.prompt).length > 0;
}

// ─── Narration serialization queue ──────────────────────────────────
// Solves the concurrency problem: turns can arrive faster than the LLM
// can stream a response. Without serialization, pre-queue code silently
// dropped narration requests that hit an in-flight call and corrupted
// the aggregate-diff baseline in the process.
//
// The queue model:
//   - At most one narration is "in flight" at any time.
//   - `pendingCoalesce` is a single-slot buffer for "another narration
//     was requested while one was in flight." Extra requests while the
//     slot is already set don't accumulate — they just keep the flag true.
//   - `turnLog` accumulates every turn's events regardless of whether
//     narration fires, so the next narration (whenever it runs) covers
//     all turns since the last one that actually completed.
//   - `lastNarrationSnapshot` is the baseline for aggregate diffs; it's
//     only advanced when a narration ACTUALLY starts running (inside
//     runNarrationLoop), not at the point we decide we'd like to run one.
//   - `latestState` is the freshest state seen, used by the loop to
//     narrate against "now" rather than "whenever the caller fired."
let narrationInFlight = false;
let pendingCoalesce = false;
let latestState: GameState | null = null;

/** Run a single narration, then drain any pending coalesce requests that
 *  accumulated while it was in flight. The do-while structure IS the
 *  queue: as long as new narration requests keep arriving while one is
 *  running, keep processing them; exit cleanly once the queue is empty. */
async function runNarrationLoop(): Promise<void> {
  narrationInFlight = true;
  try {
    do {
      pendingCoalesce = false;

      // Drain: snapshot the accumulated log, clear it, compute the
      // aggregate diff against the last ACTUALLY-narrated baseline,
      // then advance the baseline. All of this bookkeeping moved OUT
      // of maybeNarrate so that dropped/coalesced requests don't
      // corrupt the aggregate diff baseline anymore.
      const state = latestState;
      if (!state) break;
      const log = turnLog.slice();
      turnLog = [];
      const aggregatedDiff = lastNarrationSnapshot
        ? computeDiff(lastNarrationSnapshot, state)
        : [];
      lastNarrationSnapshot = captureSnapshot(state);

      try {
        await narrate(state, log, aggregatedDiff);
      } catch (err: any) {
        // Don't let a single failure freeze the queue — log it and
        // fall through to drain any pending request.
        console.error('[NARRATION]', err);
        llmState.currentNarration = `[Narration error: ${err?.message || err}]`;
      }
    } while (pendingCoalesce);
  } finally {
    narrationInFlight = false;
  }
}

/**
 * Called after every state update. Accumulates turn-level bookkeeping
 * unconditionally (so nothing is lost regardless of queue state) and
 * then either fires a fresh narration, coalesces into a pending slot,
 * or no-ops if narration isn't warranted.
 */
export function maybeNarrate(state: GameState): void {
  if (state.game_over) return;

  // Track the latest state for the queue loop. Only done on non-game-over
  // turns so the loop always narrates against a live state.
  latestState = state;

  // Compute single-turn diff and build turn record
  const diffLines = lastTurnSnapshot ? computeDiff(lastTurnSnapshot, state) : [];
  const actionDesc = describeActionContext(state.player.x, state.player.y);
  const messages = filterMessages(state.messages, state.prompt);

  if (diffLines.length > 0 || actionDesc || messages.length > 0) {
    console.log('[TURN DIFF]', {
      turn: state.turn,
      action: actionDesc || undefined,
      changes: diffLines.length > 0 ? diffLines : undefined,
      messages: messages.length > 0 ? messages : undefined,
      logSize: turnLog.length + 1,
    });
  }

  // Append to the rolling turn log — ALWAYS, regardless of whether we
  // end up firing a narration this turn. The old code cleared the log
  // when narration fired, which was fine, but ALSO cleared it when a
  // narration was silently dropped by the isGenerating guard, which
  // lost the turn data permanently. Now the log is only cleared inside
  // runNarrationLoop at the point a narration actually runs.
  turnLog.push({
    turn: state.turn,
    action: actionDesc,
    messages: [...messages],
    diff: diffLines,
  });

  // Save previous snapshot for trigger checks before overwriting
  const prevTurnSnapshot = lastTurnSnapshot;

  // Always update turn snapshot for next single-turn diff
  lastTurnSnapshot = captureSnapshot(state);

  // Initialize narration snapshot on first turn
  if (!lastNarrationSnapshot) {
    lastNarrationSnapshot = lastTurnSnapshot;
  }

  if (!llmState.isConfigured) return;
  if (!llmState.isNarrationEnabled) return;

  const filteredMsgs = filterMessages(state.messages, state.prompt);
  if (!shouldTriggerNarration(state, llmState.triggerConfig, prevTurnSnapshot, filteredMsgs)) return;

  if (narrationInFlight) {
    // Coalesce: another request came in while one is streaming. The
    // next drain iteration will cover everything that has accumulated
    // in turnLog since the in-flight narration started. Don't touch
    // lastNarrationSnapshot here — that would corrupt the baseline.
    pendingCoalesce = true;
    return;
  }

  // No narration in flight — start the loop. Fire-and-forget.
  void runNarrationLoop();
}

/** Reset the queue state (in-flight flag, pending coalesce, latest
 *  state pointer). Exposed for tests only — production code never
 *  needs to reset this because it's driven entirely by maybeNarrate. */
export function resetNarrationQueue(): void {
  narrationInFlight = false;
  pendingCoalesce = false;
  latestState = null;
}

/** Test-only accessor for queue state inspection. */
export function getNarrationQueueState(): { inFlight: boolean; pending: boolean } {
  return { inFlight: narrationInFlight, pending: pendingCoalesce };
}

/** Quick test to verify LLM configuration works */
export async function testLLMConnection(): Promise<string> {
  try {
    const { generateText } = await import('ai');
    const modelInstance = await getModel(llmState.provider, llmState.narratorModel, llmState.apiKey);
    const { text } = await generateText({
      model: modelInstance,
      prompt: 'Respond with exactly: "LLM connection OK"',
      maxOutputTokens: 20,
    });
    return text;
  } catch (err: any) {
    throw new Error(err.message || String(err));
  }
}
