declare module "@neth4ck/api" {
  export class NethackStateManager {
    constructor(options?: Record<string, any>);
    start(createModule: any, moduleOptions?: Record<string, any>): Promise<this>;

    // State getters
    get state(): any;
    get map(): any[][];
    get cursor(): { x: number; y: number };
    get status(): {
      title: string;
      str: string | number;
      dx: number;
      co: number;
      in: number;
      wi: number;
      ch: number;
      align: string;
      score: number;
      carrying: string;
      gold: number;
      energy: number;
      energyMax: number;
      xpLevel: number;
      ac: number;
      hd: number;
      time: number;
      hunger: string;
      hp: number;
      hpMax: number;
      levelDesc: string;
      dlvl: number;
      exp: number;
    };
    get messages(): any[];
    get conditions(): Set<string>;
    get phase(): "init" | "charSelect" | "playing" | "gameOver";
    get pendingInput(): { type: string; query?: string; choices?: string; default?: string } | null;
    get pendingInputType(): string | null;
    get isWaitingForInput(): boolean;
    get activeMenu(): { windowId: any; prompt: string; selectionMode: any; items: any[] } | null;
    get inventory(): any[];
    get inventoryNeedsUpdate(): boolean;
    get monsters(): any[] | null;
    get visibleMonsters(): Array<{
      x: number; y: number; monsterIndex: number;
      name: string; isPet: boolean; isRidden: boolean; isDetected: boolean;
      givenName?: string;
    }>;
    get visibleItems(): Array<{
      x: number; y: number; ch: string; color: number;
      glyph: number; tileType: string; tileLabel: string | null; category: string;
      obscured: boolean;
    }>;
    get visibleFeatures(): Array<{
      x: number; y: number; ch: string; color: number;
      glyph: number; name: string;
      obscured: boolean;
    }>;
    get module(): any;
    get constants(): any;
    get globals(): any;
    get helpers(): any;

    // Events
    on(event: string, fn: (...args: any[]) => void): this;
    once(event: string, fn: (...args: any[]) => void): this;
    off(event: string, fn: (...args: any[]) => void): this;

    // High-level actions
    action(name: string): void;
    quit(): Promise<void>;

    // Input
    handleKey(key: string | number): void;
    sendKey(key: string | number): void;
    sendDirection(dir: string): void;
    move(dir: string): void;
    rest(): void;
    search(): void;
    answerYn(answer: string | number): void;
    answerLine(text: string): void;
    selectMenuItems(identifiers: any[]): void;
    selectMenuItem(identifier: any): void;
    dismissMenu(): void;
    sendExtCmd(cmdIndex: number): void;
    resolveCharSelect(value: any): void;
    sendPosition(x: number, y: number, mod?: number): void;
    refreshInventory(): void;
  }

  export class EventEmitter {
    on(event: string, fn: (...args: any[]) => void): void;
    once(event: string, fn: (...args: any[]) => void): void;
    off(event: string, fn: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
  }

  export const MAP_WIDTH: number;
  export const MAP_HEIGHT: number;
  export const DIRECTIONS: Record<string, string>;
  export const KEY_CODES: Record<string, number>;
  export const ATTR: Record<string, number>;
  export const COLORS: Record<string, number>;
  export const STATUS_FIELDS: string[];
  export const CONDITIONS: string[];
  export const PHASE: Record<string, string>;
  export const INPUT_TYPE: Record<string, string>;
  export const MENU_MODE: Record<string, string>;
  export const FEATURE_NAMES: Record<string, string>;
  export const ITEM_CATEGORY_BY_CHAR: Record<string, string>;
  export const OBJ_CLASS_NAMES: Record<number, string>;
  export const TERRAIN_TYPE_NAMES: Record<string, string>;
  export const TERRAIN_TYPE_CHARS: Record<string, string>;
}

declare module "@neth4ck/wasm-367" {
  const createModule: (config?: any) => Promise<any>;
  export default createModule;
}

declare module "@neth4ck/wasm-37" {
  const createModule: (config?: any) => Promise<any>;
  export default createModule;
}
