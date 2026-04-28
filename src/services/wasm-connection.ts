/**
 * NethackNarrated connection adapter — wraps @neth4ck/api's NethackStateManager
 * and translates its event-driven state into the existing GameState interface.
 *
 * Preserves the exact same public API so all components, stores, and services
 * remain unchanged.
 */

import { NethackStateManager, MAP_WIDTH, MAP_HEIGHT, OBJ_CLASS_NAMES } from "@neth4ck/api";
import type {
  GameState,
  CharacterOptions,
  PlayerStats,
  Entity,
  MonsterEntity,
  ItemEntity,
  InventoryItem,
  NethackRuntimeVersion,
  SaveSlot,
} from "../types/game";
import { gameState } from "../state/game.svelte";
import {
  createSlotId,
  getSlotSaveDir,
  getLegacySaveDir,
  loadSlotRegistry,
  updateSlotInRegistry,
  removeSlotFromRegistry,
} from "../utils/save-detection";
import { scanTerrain } from "../utils/terrain-scanner";
import {
  saveNarrationStateForSlot,
  loadNarrationStateForSlot,
  clearNarrationStateForSlot,
} from "./llm-service";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type StateCallback = (state: GameState) => void;
export type StatusCallback = (status: ConnectionStatus, error?: string) => void;

// ── Base NETHACKOPTIONS for all games ──
const BASE_OPTIONS = [
  "color", "number_pad:0", "runmode:walk", "time",
  "showexp", "showscore", "boulder:0",
];

export class NethackConnection {
  private game: NethackStateManager | null = null;
  private onState: StateCallback | null = null;
  private onStatus: StatusCallback | null = null;
  private _isConnected = false;
  private _runtimeVersion: NethackRuntimeVersion = "3.7";

  // Per-turn message accumulator
  private pendingMessages: string[] = [];

  // Text window lines (blocking display_nhwindow content, e.g. chest contents)
  private pendingTextWindow: string[] = [];

  // Promise resolvers for request-response pattern
  private stateResolvers: Array<(state: GameState) => void> = [];

  // Game over tracking
  private _gameOver = false;
  private _gameOverReason = "";
  private _wasSaved = false;

  // Player name for auto-answering askname prompt
  private _playerName = "Player";

  // Current save slot ID (for multi-slot saves)
  private _currentSlotId = "";

  setStateCallback(cb: StateCallback) {
    this.onState = cb;
  }

  setStatusCallback(cb: StatusCallback) {
    this.onStatus = cb;
  }

  /** Initialize (no-op for WASM — actual init happens in reset()). */
  async connect(): Promise<void> {
    this.onStatus?.("connecting");
    this._isConnected = true;
    this.onStatus?.("connected");
  }

  disconnect() {
    this.game = null;
    this._isConnected = false;
    this.onStatus?.("disconnected");
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get runtimeVersion(): NethackRuntimeVersion {
    return this._runtimeVersion;
  }

  /** Intro backstory text captured during startup (array of lines). */
  get introText(): string[] {
    return (this.game as any)?.introText ?? [];
  }

  /** Handle a map click — API decides whether to move or send position. */
  handleClick(x: number, y: number): void {
    if (!this.game) return;
    (this.game as any).handleClick?.(x, y);
  }

  /** Whether the game is in position selection mode (far-look, targeting, etc.).
   * Reads directly from the C engine's input state. */
  get awaitingPosition(): boolean {
    return (this.game as any)?.isPositionSelection ?? false;
  }

  /** Send a map position (for position prompts like far-look). */
  async sendPosition(x: number, y: number): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");
    const typeBefore = this.game.pendingInputType;
    this.game.sendPosition(x, y);
    // If the API handled it (dismissed menu or sent position), wait for next state.
    // If input was dropped (type unchanged), just return current state.
    if (this.game.pendingInputType === typeBefore && typeBefore !== "poskey") {
      return this._buildGameState();
    }
    return this.waitForNextState();
  }

  /** Start a new game with the given character options. */
  async reset(options?: CharacterOptions, version?: NethackRuntimeVersion): Promise<GameState> {
    if (version) this._runtimeVersion = version;
    gameState.runtimeVersion = this._runtimeVersion;

    // Reset state
    this._gameOver = false;
    this._gameOverReason = "";
    this._wasSaved = false;
    this.pendingMessages = [];
    this.stateResolvers = [];
    this._playerName = "Player";

    // Slot-based save: slotId means continue existing slot
    const continuing = !!options?.slotId;
    if (continuing) {
      this._currentSlotId = options!.slotId!;
      const slots = loadSlotRegistry();
      const slot = slots.find(s => s.slotId === this._currentSlotId);
      if (slot?.name) this._playerName = slot.name;
    } else {
      this._currentSlotId = createSlotId();
    }

    // Build nethackOptions for the API.
    // Only include role/race/gender/align when explicitly chosen —
    // "random" is the default when omitted, and passing "random" as a
    // string value can break NETHACKOPTIONS parsing in some versions.
    // Pet name → set all three NETHACKOPTIONS (catname, dogname, horsename)
    // so the name applies regardless of which pet type the class gets.
    const extraOpts = [...BASE_OPTIONS];
    if (!continuing && options?.petName) {
      extraOpts.push(`catname:${options.petName}`);
      extraOpts.push(`dogname:${options.petName}`);
      extraOpts.push(`horsename:${options.petName}`);
    }

    const nethackOpts: Record<string, any> = {
      name: options?.name || this._playerName,
      skipTutorial: options?.skipTutorial ?? true,
      options: extraOpts,
    };
    if (!continuing) {
      if (options?.role && options.role !== "random") nethackOpts.role = options.role;
      if (options?.race && options.race !== "random") nethackOpts.race = options.race;
      if (options?.gender && options.gender !== "random") nethackOpts.gender = options.gender;
      if (options?.align && options.align !== "random") nethackOpts.align = options.align;
    }

    // Dynamic import of WASM module factory
    let createModule: any;
    let wasmAssetPath: string;
    if (this._runtimeVersion === "3.7") {
      const mod = await import("@neth4ck/wasm-37");
      createModule = mod.default;
      wasmAssetPath = "nethack-37.wasm";
    } else {
      const mod = await import("@neth4ck/wasm-367");
      createModule = mod.default;
      wasmAssetPath = "nethack-367.wasm";
    }

    // Create new state manager — import uiState lazily to avoid circular deps
    const { uiState } = await import("../state/ui.svelte");
    this.game = new NethackStateManager({
      autoResolvePickNone: uiState.autoResolvePickNone,
      autoDismissMenus: "resend",
    });
    this._wireEvents();

    // Debug: trace ALL callbacks to find where 3.6.7 hangs
    let cbCount = 0;
    this.game.on("rawCallback", (name: string, args: any[]) => {
      cbCount++;
      if (cbCount <= 50 || name === "shim_putstr") {
        console.log(`[rawCallback #${cbCount}] ${name}${name === "shim_putstr" ? " " + JSON.stringify(args) : ""}`);
      }
    });

    // Start the game — the API now handles the full startup sequence
    // (charSelect, askname, intro text, tutorial) before resolving.
    console.log("[reset] calling game.start()...");
    await this.game.start(createModule, {
      nethackOptions: nethackOpts,
      saves: continuing ? "load" : "clear",
      saveDir: this._currentSlotId.startsWith("migrated-")
        ? getLegacySaveDir(this._runtimeVersion)
        : getSlotSaveDir({ slotId: this._currentSlotId, version: this._runtimeVersion }),
      locateFile: (assetPath: string) => {
        if (assetPath.endsWith(".wasm")) {
          return this._resolveWasmAssetUrl(wasmAssetPath);
        }
        return this._resolveWasmAssetUrl(assetPath);
      },
      quit: (status: number, toThrow: any) => {
        this._gameOver = true;
        this._gameOverReason = toThrow?.message || `Program terminated with exit(${status})`;
        this._emitState();
        if (toThrow) throw toThrow;
      },
      onExit: (status: number) => {
        this._gameOver = true;
        this._gameOverReason = `Program terminated with exit(${status})`;
        this._emitState();
      },
    });

    // Startup messages (e.g. "Hello Player, welcome to NetHack!") were
    // already captured by the message event listener during start().
    // If pendingMessages is empty (cleared by a mapUpdate during startup),
    // pull them from game.startupMessages so the first state has them.
    if (this.pendingMessages.length === 0) {
      const startupMsgs = (this.game as any).startupMessages || [];
      this.pendingMessages.push(...startupMsgs.map((m: any) => m.text));
    }

    this._isConnected = true;

    // If we're resuming an existing slot, restore its persisted LLM
    // narration state (session history + UI entries) so the LLM keeps
    // its memory of the run across save/load.
    if (continuing) {
      loadNarrationStateForSlot(this._currentSlotId);
    }

    // Build the first game state, then clear pending messages so they
    // don't bleed into the first action's state.
    const firstState = this._buildGameState();
    this.pendingMessages = [];
    console.log(`[reset] game ready, phase=${this.game.phase} turn=${firstState.turn} hp=${firstState.player?.hp}`);
    return firstState;
  }

  /** Send a named action (e.g. "move_north", "eat", "eat:d").
   *  If the action can't be dispatched (e.g. a prompt is active),
   *  logs a warning and returns the current state. */
  async action(action: string): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");

    const statePromise = this.waitForNextState();
    try {
      this.game.action(action);
    } catch (e: any) {
      if (e.message?.includes("cannot start verb command")
          || e.message?.includes("cannot dispatch action")
          || e.message?.includes("yn prompt is active")
          || e.message?.includes("another input sequence")) {
        console.warn(`[action] ${action} blocked — ${e.message}`);
        return this._buildGameState();
      }
      throw e;
    }
    return statePromise;
  }

  /** Send a raw keystroke (used during prompts). */
  async rawKey(key: string): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");

    const statePromise = this.waitForNextState();

    try {
      // API handles prompt-type routing
      this.game.handleKey(key);
    } catch (e: any) {
      // Game may have ended between the prompt being shown and the user
      // clicking — the WASM has no pending input left. Return current state.
      if (this._gameOver && /no pending input/i.test(e?.message)) {
        return this._buildGameState();
      }
      throw e;
    }

    return statePromise;
  }

  /** Send a line of text (used for naming, engraving, etc.). */
  async sendLine(text: string): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");

    const statePromise = this.waitForNextState();
    this.game.answerLine(text);
    return statePromise;
  }

  /** Get current game state without performing an action. */
  async getState(): Promise<GameState> {
    return this._buildGameState();
  }

  /** Quit the game. Auto-confirms all prompts. */
  async quit(): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");
    const statePromise = this.waitForNextState();
    this.game.quit();
    return statePromise;
  }

  /** Save the game and exit. Auto-confirms all prompts.
   *  The API handles IndexedDB sync before returning. */
  async save(): Promise<GameState> {
    if (!this.game) throw new Error("Not connected");

    // Mark as saved BEFORE calling game.save(), because the gameOver
    // and phaseChange event handlers fire during save() and would
    // otherwise clear the save metadata.
    this._wasSaved = true;
    this._gameOver = true;

    // game.save() is async — it sends #save, auto-answers prompts,
    // waits for the game to exit, syncs to IndexedDB, then resolves.
    await this.game.save();

    // Persist LLM narration state alongside the WASM save so the next
    // load restores the session history and narration entries.
    saveNarrationStateForSlot(this._currentSlotId);

    // Build and return the final state directly (don't wait for
    // statePromise — the event handlers may have already consumed it).
    return this._buildGameState();
  }

  // ──────────────────── Internal ────────────────────

  private waitForNextState(): Promise<GameState> {
    return new Promise((resolve) => {
      this.stateResolvers.push(resolve);
    });
  }



  private _wireEvents() {
    if (!this.game) return;

    // Accumulate messages per turn
    this.game.on("message", (msg: any) => {
      if (msg?.text) {
        this.pendingMessages.push(msg.text);
        console.log(`[message] "${msg.text}"`);
      }
    });

    // Capture text window content (e.g. "Contents of the chest:")
    // so the PromptBar can display it when the game blocks for a key press.
    // Skip during startup — intro lore text windows are handled separately
    // via the introText property and displayed in the intro modal.
    this.game.on("textWindow", (lines: string[]) => {
      if (this.game?.phase === "playing") {
        this.pendingTextWindow = lines;
      }
    });

    // Track last player action and build an action context that groups
    // the initiating action with any prompt interactions that follow.
    // Prompt responses (answer, menuSelect, etc.) append to the current
    // context rather than overwriting lastAction.
    const PROMPT_RESPONSES = new Set(["answer", "menuSelect", "menuDismiss", "lineDismiss", "lineAnswer", "key"]);
    this.game.on("actionTaken", (info: any) => {
      if (PROMPT_RESPONSES.has(info.action)) {
        // Append prompt interaction to current action context
        if (gameState.actionContext && info.promptQuery) {
          let answer: string;
          if (info.action === "answer") {
            const ch = typeof info.key === "string" ? info.key : String.fromCharCode(info.key);
            answer = ch;
          } else if (info.action === "lineAnswer") {
            answer = typeof info.key === "string" ? info.key : String(info.key);
          } else if (info.action === "menuDismiss" || info.action === "lineDismiss") {
            answer = "dismissed";
          } else if (info.action === "menuSelect") {
            const rawKey = typeof info.key === "string" ? info.key : String(info.key);
            // Look up menu item text so narration gets a description
            // (e.g. "Look inside the chest" instead of ":")
            const menuItem = gameState.menuItems.find(
              item => item.menuChar === rawKey
            );
            answer = menuItem ? menuItem.text : rawKey;
          } else {
            answer = String(info.key ?? "");
          }
          // Enrich with item name if the API resolved the key to an inventory item
          if (info.itemName) {
            answer = `${answer} (${info.itemName})`;
          }
          gameState.actionContext.prompts.push({
            type: info.promptType || info.action,
            query: info.promptQuery,
            answer,
          });
        }
        return;
      }

      if (info.item && !info.itemName && this.game) {
        const inv = this.game.inventory?.find((i: any) => i.letter === info.item);
        if (inv) {
          // displayText is NetHack's canonical description (e.g. "10 uncursed
          // carrots") but includes the full stack quantity. Strip the leading
          // number for single-action context (eating one carrot, reading one
          // scroll). Falls back to base name if no displayText.
          let itemName = inv.displayText ?? inv.name;
          if (itemName && inv.quantity > 1) {
            itemName = itemName.replace(/^\d+\s+/, "");
          }
          info.itemName = itemName;
        }
      }
      gameState.lastAction = info;
      gameState.actionContext = { action: { ...info }, prompts: [] };
    });

    // Emit state when the game pauses for input — this is when all
    // messages, map updates, and status changes for the turn are complete.
    // mapUpdate fires mid-turn before messages may be fully accumulated,
    // so we only emit on inputRequired to avoid clobbering messages.
    this.game.on("inputRequired", () => {
      if (!this.game?.isWaitingForInput) return;
      this._emitState();
      this.pendingMessages = [];
      this.pendingTextWindow = [];
    });

    // Game over — detect whether the player saved (#save) or died/quit.
    // If _wasSaved is already true (set by save() before this fires),
    // skip the detection and keep metadata intact.
    this.game.on("gameOver", (info: any) => {
      this._gameOver = true;
      this._gameOverReason = info?.how || "Game ended";

      if (!this._wasSaved) {
        const saves = this.game?.listSaves?.() ?? [];
        this._wasSaved = saves.length > 0;
        if (!this._wasSaved) {
          removeSlotFromRegistry(this._currentSlotId);
          clearNarrationStateForSlot(this._currentSlotId);
        }
      }

      this._emitState();
    });

    // Phase changes — also detect saves here since save()/quit() emit
    // phaseChange but not the gameOver event.
    this.game.on("phaseChange", (phase: string) => {
      console.log(`[phaseChange] ${phase}`);
      if (phase === "gameOver") {
        if (!this._gameOver) {
          this._gameOver = true;
          if (!this._gameOverReason) this._gameOverReason = "Game ended";

          if (!this._wasSaved) {
            const saves = this.game?.listSaves?.() ?? [];
            this._wasSaved = saves.length > 0;
            if (!this._wasSaved) {
              removeSlotFromRegistry(this._currentSlotId);
            }
          }
        }
        // Always emit state so waitForNextState() resolvers fire
        // (e.g. double quit, where the API re-emits phaseChange)
        this._emitState();
      }
    });
  }

  private _emitState() {
    const state = this._buildGameState();
    console.log(`[emitState] turn=${state.turn} hp=${state.player?.hp} map_rows=${state.map?.length} msgs=${state.messages?.length} entities=${state.entities?.length} awaiting=${state.awaiting_input} phase=${this.game?.phase}`);

    // Persist save metadata while playing (for the Continue screen)
    if (!state.game_over && state.turn > 0) {
      this._updateSaveMeta(state);
    }

    // Notify waiters
    const resolvers = [...this.stateResolvers];
    this.stateResolvers = [];
    for (const resolve of resolvers) {
      resolve(state);
    }

    // Notify callback
    this.onState?.(state);
  }

  private _buildGameState(): GameState {
    const game = this.game!;
    // Ensure inventory is fresh from WASM memory before building state.
    // The API's inputRequired handler should have already done this, but
    // timing with interceptors/setTimeout can leave stale data.
    game.refreshInventory();
    const status = game.status;
    const playerPos = game.playerPos;

    // dlvl is now parsed by the API from levelDesc
    const dlvl = status.dlvl || 0;

    // Parse STR which may be a string like "18/50" or a number
    let str: number;
    if (typeof status.str === "string") {
      const parts = status.str.split("/");
      str = parseInt(parts[0], 10) || 0;
    } else {
      str = Number(status.str) || 0;
    }

    const player: PlayerStats = {
      x: playerPos.x,
      y: playerPos.y,
      hp: status.hp || 0,
      max_hp: status.hpMax || 0,
      pw: status.energy || 0,
      max_pw: status.energyMax || 0,
      ac: status.ac || 0,
      str,
      dex: status.dx || 0,
      con: status.co || 0,
      int: status.in || 0,
      wis: status.wi || 0,
      cha: status.ch || 0,
      xp: status.exp || 0,
      xp_level: status.xpLevel || 0,
      gold: status.gold || 0,
      hunger: String(status.hunger || "Not Hungry"),
      score: status.score || 0,
      turn: status.time || 0,
      dlvl,
    };

    // Build map strings
    const map = this._buildMapStrings();

    // Build entities
    const entities = this._buildEntities(playerPos.x, playerPos.y);

    // Build inventory
    const inventory = this._buildInventory();

    // Build conditions
    const conditions: string[] = Array.from(game.conditions);

    // Build active properties (intrinsics/extrinsics from u.uprops[])
    const activeProps = game.activeProperties;
    const properties: string[] = activeProps ? Array.from(activeProps) : [];

    // Warned monster types (for WARN_OF_MON specificity)
    const warnedMonsters: string[] = game.warnedMonsters ?? [];

    // Build prompt info
    const pendingInput = game.pendingInput;
    let prompt = "";
    let promptChoices = "";
    let menuItems: { menuChar: string; text: string; isSelectable: boolean }[] = [];

    if (pendingInput) {
      prompt = (pendingInput as any).query || "";
      promptChoices = (pendingInput as any).choices || "";
    }

    const activeMenu = game.activeMenu;
    if (activeMenu && game.pendingInputType === "menu") {
      prompt = prompt || (activeMenu as any).prompt || "";
      menuItems = ((activeMenu as any).items || []).map((item: any) => ({
        menuChar: item.accelerator || "",
        text: item.text || "",
        isSelectable: !!item.identifier,
      }));
    }

    return {
      type: "state",
      turn: player.turn,
      dlvl,
      map,
      player,
      messages: [...this.pendingMessages],
      inventory,
      conditions,
      properties,
      warnedMonsters,
      name_title: String(status.title || ""),
      role: String(game.role || ""),
      race: String(game.race || ""),
      gender: String(game.gender || ""),
      alignment: String(status.align || ""),
      entities,
      cursor: game.cursor,
      awaiting_input: game.isWaitingForInput,
      input_type: game.pendingInputType,
      prompt,
      prompt_choices: promptChoices,
      menu_items: menuItems,
      menu_selection_mode: (activeMenu as any)?.selectionMode ?? null,
      text_window_lines: game.pendingInputType === "key" ? [...this.pendingTextWindow] : [],
      game_over: this._gameOver || game.phase === "gameOver",
      game_over_reason: this._gameOverReason,
      // The bulk terrain map is consumed by scanTerrain (which needs
      // typ/vision/lit/roomNo arrays for room detection, exit colors,
      // etc.) but is NOT exposed to the state store — the only thing
      // the frontend needs for rendering is the per-tile top-glyph
      // color, which comes from game.map[y][x].color and is built by
      // _buildMapColors below.
      mapColors: this._buildMapColors(),
      ...(() => {
        const tm = (game as any).getTerrainMap?.();
        if (tm) {
          return { terrain: scanTerrain(game, playerPos.x, playerPos.y, tm) };
        }
        const empty = {
          chars: '',
          colors: new Uint8Array(0),
          typs: new Uint8Array(0),
          visions: new Uint8Array(0),
          lits: new Uint8Array(0),
          roomNos: new Uint8Array(0),
        };
        return { terrain: scanTerrain(game, playerPos.x, playerPos.y, empty) };
      })(),
    };
  }

  /** Build the per-tile top-glyph color array for MapDisplay rendering.
   *  Reads `game.map[y][x].color` directly — NetHack already resolved
   *  render priority (monster > item > feature > terrain), so this
   *  byte matches whatever `ch` is being drawn at the tile. Returns a
   *  row-major Uint8Array of length `MAP_WIDTH * MAP_HEIGHT`. */
  private _buildMapColors(): Uint8Array {
    const out = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    if (!this.game) return out;
    const gameMap = this.game.map;
    if (!gameMap) return out;
    for (let y = 0; y < MAP_HEIGHT && y < gameMap.length; y++) {
      const row = gameMap[y];
      if (!row) continue;
      for (let x = 0; x < MAP_WIDTH && x < row.length; x++) {
        const tile = row[x];
        if (tile) out[y * MAP_WIDTH + x] = tile.color & 0xff;
      }
    }
    return out;
  }

  private _buildMapStrings(): string[] {
    if (!this.game) return [];
    const gameMap = this.game.map;
    if (!gameMap || gameMap.length === 0) return [];

    const rows: string[] = [];
    for (let y = 0; y < MAP_HEIGHT && y < gameMap.length; y++) {
      const row = gameMap[y];
      if (!row) { rows.push(""); continue; }
      let line = "";
      for (let x = 0; x < MAP_WIDTH && x < row.length; x++) {
        const tile = row[x];
        line += tile && tile.ch ? String.fromCharCode(tile.ch) : " ";
      }
      rows.push(line);
    }
    return rows;
  }

  private _buildEntities(playerX: number, playerY: number): Entity[] {
    if (!this.game) return [];
    const entities: Entity[] = [];
    const gameMap = this.game.map;

    // Add player entity
    if (playerX > 0 || playerY > 0) {
      const playerTile = gameMap?.[playerY]?.[playerX];
      entities.push({
        type: "monster",
        x: playerX,
        y: playerY,
        name: "you",
        char: "@",
        color: playerTile?.color || 0,
        pet: false,
      });
    }

    // Add visible monsters from API
    const visibleMonsters = this.game.visibleMonsters || [];
    for (const vm of visibleMonsters) {
      if (vm.x === playerX && vm.y === playerY) continue;
      const tile = gameMap?.[vm.y]?.[vm.x];
      const char = tile && tile.ch ? String.fromCharCode(tile.ch) : "?";
      const color = tile?.color || 0;
      // Given name already resolved by the API (via _get_monster_givenname)
      const givenName = vm.givenName;
      entities.push({
        type: "monster",
        x: vm.x,
        y: vm.y,
        name: givenName
          ? `${givenName} (${vm.isPet ? "pet " : ""}${vm.name || "creature"})`
          : (vm.name || "creature"),
        ...(givenName ? { givenName } : {}),
        ...(vm.m_id ? { m_id: vm.m_id } : {}),
        char,
        color,
        pet: vm.isPet || false,
      });
    }

    // Add visible items from API (objects, statues, corpses).
    // Obscured items (under a monster/player) are included with the flag
    // so consumers can decide whether to show them.
    const visibleItems = this.game.visibleItems || [];
    for (const item of visibleItems) {
      const a = item as any;
      const tileLabel = item.tileLabel || item.tileType;
      // Prefer the C engine name (from distant_name/doname) — this is
      // farlook-level detail, freely available to the player at zero cost.
      // Falls back to tileLabel for statues/corpses, then undefined (which
      // causes narration to use the glyph category as a last resort).
      const itemName = a.name
        || (item.tileLabel ? item.tileLabel : undefined);
      entities.push({
        type: "item",
        x: item.x,
        y: item.y,
        category: (item.tileType === "statue" || item.tileType === "corpse") ? tileLabel : item.category,
        char: item.ch,
        color: item.color,
        ...(itemName ? { name: itemName } : {}),
        ...(item.obscured ? { obscured: true } : {}),
        ...(a.o_id ? { o_id: a.o_id as number } : {}),
        ...(a.dknown !== undefined ? { dknown: !!a.dknown } : {}),
      });
    }

    // Add remembered items — things the hero saw before but can no longer see.
    // These come from NetHack's built-in glyph memory (levl[x][y].glyph).
    const rememberedItems = (this.game as any).rememberedItems || [];
    for (const item of rememberedItems) {
      const name = item.tileLabel || item.tileType;
      entities.push({
        type: "item",
        x: item.x,
        y: item.y,
        category: (item.tileType === "statue" || item.tileType === "corpse") ? name : item.category,
        char: item.ch,
        color: item.color,
        ...(item.tileLabel ? { name: item.tileLabel } : {}),
        remembered: true,
      });
    }

    // Add visible features from API (stairs, fountains, altars, etc.) —
    // includes obscured features (e.g. staircase under player) for the legend
    const visibleFeatures = this.game.visibleFeatures || [];
    for (const feat of visibleFeatures) {
      entities.push({
        type: "item",
        x: feat.x,
        y: feat.y,
        category: feat.name,
        char: feat.ch,
        color: feat.color,
        name: feat.name,
      });
    }

    return entities;
  }

  private _buildInventory(): InventoryItem[] {
    if (!this.game) return [];
    const apiItems = this.game.inventory || [];

    return apiItems.map((item: any) => {
      const letter = item.letter || "";
      const oclass = OBJ_CLASS_NAMES[item.oclass] || "item";
      const text = item.displayText || item.name || item.appearance || "something";
      const worn = !!item.worn;
      return { letter, text, oclass, worn };
    });
  }

  /** Whether the last game ended via #save (vs death/quit). */
  get wasSaved(): boolean {
    return this._wasSaved;
  }

  /** Update the current slot's metadata in the registry. */
  private _updateSaveMeta(state: GameState) {
    if (!this._currentSlotId) return;
    const slot: SaveSlot = {
      slotId: this._currentSlotId,
      version: this._runtimeVersion,
      name: (this.game as any)?.playerName || this._playerName,
      role: state.role,
      race: state.race,
      gender: state.gender,
      alignment: state.alignment,
      turn: state.turn,
      dlvl: state.dlvl,
      title: state.name_title,
      date: Date.now(),
    };
    updateSlotInRegistry(slot);
  }

  /** Get the current slot ID (for external use, e.g. GameOverOverlay). */
  get currentSlotId(): string {
    return this._currentSlotId;
  }

  private _resolveWasmAssetUrl(assetPath: string): string {
    const normalizedAsset = String(assetPath || "").replace(/^\/+/, "");
    const baseUrl =
      typeof (import.meta as any).env?.BASE_URL === "string" &&
      (import.meta as any).env.BASE_URL.trim()
        ? (import.meta as any).env.BASE_URL.trim()
        : "/";
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const referenceUrl =
      typeof globalThis.location?.href === "string" && globalThis.location.href
        ? globalThis.location.href
        : (import.meta as any).url;
    return new URL(`${normalizedBase}${normalizedAsset}`, referenceUrl).href;
  }
}

/** Singleton connection instance */
export const connection = new NethackConnection();
