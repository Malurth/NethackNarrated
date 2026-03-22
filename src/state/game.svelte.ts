import type { GameState, PlayerStats, Entity, InventoryItem, ActionContext, NethackRuntimeVersion, TerrainSummary } from '../types/game';

class GameStore {
  runtimeVersion = $state<NethackRuntimeVersion>('3.7');
  turn = $state(0);
  dlvl = $state(0);
  map = $state<string[]>([]);
  player = $state<PlayerStats | null>(null);
  messages = $state<string[]>([]);
  messageHistory = $state<string[]>([]);
  inventory = $state<InventoryItem[]>([]);
  conditions = $state<string[]>([]);
  properties = $state<string[]>([]);
  warnedMonsters = $state<string[]>([]);
  nameTitle = $state('');
  role = $state('');
  race = $state('');
  gender = $state('');
  alignment = $state('');
  entities = $state<Entity[]>([]);
  cursor = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  awaitingInput = $state(false);
  inputType = $state<string | null>(null);
  prompt = $state('');
  promptChoices = $state('');
  menuItems = $state<{ menuChar: string; text: string; isSelectable: boolean }[]>([]);
  menuSelectionMode = $state<string | number | null>(null);
  textWindowLines = $state<string[]>([]);
  gameOver = $state(false);
  gameOverReason = $state('');
  lastAction = $state<Record<string, any> | null>(null);
  actionContext = $state<ActionContext | null>(null);
  /** Terrain/vision summary for AI narration */
  terrain = $state<TerrainSummary | null>(null);
  /** Per-tile NetHack top-glyph color (0-15), row-major (y * 80 + x).
   *  Resolved by NetHack priority — matches what `map[y][x]` is actually
   *  rendering. Used by MapDisplay for cell colors. */
  mapColors = $state<Uint8Array>(new Uint8Array(0));
  /** Intro backstory/lore text captured at game start */
  introText = $state<string[]>([]);
  /** Snapshot of previous state for diff detection (narration heuristic) */
  previousTurn = $state(0);
  previousDlvl = $state(0);
  previousHp = $state(0);
  previousConditions = $state<string[]>([]);
  previousProperties = $state<string[]>([]);

  /** Update all fields from a server state response */
  update(state: GameState) {
    // Save previous values for diff detection
    this.previousTurn = this.turn;
    this.previousDlvl = this.dlvl;
    this.previousHp = this.player?.hp ?? 0;
    this.previousConditions = [...this.conditions];
    this.previousProperties = [...this.properties];

    // Update current state
    this.turn = state.turn;
    this.dlvl = state.dlvl;
    this.map = state.map;
    this.player = state.player;
    this.messages = state.messages;
    this.inventory = state.inventory;
    this.conditions = state.conditions;
    this.properties = state.properties;
    this.warnedMonsters = state.warnedMonsters;
    this.nameTitle = state.name_title;
    this.role = state.role;
    this.race = state.race;
    this.gender = state.gender;
    this.alignment = state.alignment;
    this.entities = state.entities;
    this.cursor = state.cursor;
    this.awaitingInput = state.awaiting_input;
    this.inputType = state.input_type;
    this.prompt = state.prompt;
    this.promptChoices = state.prompt_choices;
    this.menuItems = state.menu_items;
    this.menuSelectionMode = state.menu_selection_mode;
    this.textWindowLines = state.text_window_lines;
    this.gameOver = state.game_over;
    this.gameOverReason = state.game_over_reason;
    this.terrain = state.terrain ?? null;
    this.mapColors = state.mapColors ?? new Uint8Array(0);

    // Accumulate messages into history
    if (state.messages.length > 0) {
      this.messageHistory = [...this.messageHistory, ...state.messages];
    }
  }

  /** Reset all state for a new game */
  reset() {
    this.messageHistory = [];
    this.introText = [];
    this.terrain = null;
    this.mapColors = new Uint8Array(0);
    this.previousTurn = 0;
    this.previousDlvl = 0;
    this.previousHp = 0;
    this.previousConditions = [];
    this.previousProperties = [];
  }
}

export const gameState = new GameStore();
