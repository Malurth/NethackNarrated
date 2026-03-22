import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState, MonsterEntity } from '../types/game';
import type { NarrationTriggerConfig } from '../types/narration-triggers';
import { PRESETS, DEFAULT_IGNORED_PATTERNS, patternToRegex, matchesIgnoredPattern } from '../types/narration-triggers';

// Mock the gameState import — trigger checks read previousDlvl, previousHp,
// previousConditions from the singleton store
vi.mock('../state/game.svelte', () => ({
  gameState: {
    previousDlvl: 1,
    previousHp: 16,
    previousConditions: [] as string[],
  },
}));

import {
  checkGameMessages,
  checkLevelChange,
  checkHpLoss,
  checkStatusCondition,
  checkMonsterAppeared,
  checkVisionExpansion,
  checkInventoryChange,
  shouldTriggerNarration,
} from './narration-heuristic';
import type { TriggerSnapshot } from './narration-heuristic';
import { gameState } from '../state/game.svelte';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    type: 'state',
    turn: 1,
    dlvl: 1,
    map: [],
    player: {
      x: 10, y: 10, hp: 16, max_hp: 16, pw: 4, max_pw: 4,
      ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
      xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
    },
    messages: [],
    inventory: [],
    conditions: [],
    properties: [],
    warnedMonsters: [],
    name_title: 'Player the Stripling',
    alignment: 'lawful',
    entities: [],
    cursor: { x: 10, y: 10 },
    awaiting_input: false,
    input_type: null,
    prompt: '',
    prompt_choices: '',
    menu_items: [],
    menu_selection_mode: null,
    game_over: false,
    game_over_reason: '',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TriggerSnapshot> = {}): TriggerSnapshot {
  return {
    monsters: [],
    inventory: [],
    visibleFloorTiles: 20,
    ...overrides,
  };
}

function allOnConfig(): NarrationTriggerConfig {
  return { triggers: { ...PRESETS.verbose }, activePreset: 'verbose', ignoredMessagePatterns: [] };
}

beforeEach(() => {
  (gameState as any).previousDlvl = 1;
  (gameState as any).previousHp = 16;
  (gameState as any).previousConditions = [];
});

describe('checkLevelChange', () => {
  it('returns true when dlvl changes', () => {
    expect(checkLevelChange(makeState({ dlvl: 2 }))).toBe(true);
  });

  it('returns false when dlvl is same', () => {
    expect(checkLevelChange(makeState({ dlvl: 1 }))).toBe(false);
  });

  it('returns false when previousDlvl is 0 (game start)', () => {
    (gameState as any).previousDlvl = 0;
    expect(checkLevelChange(makeState({ dlvl: 1 }))).toBe(false);
  });
});

describe('checkHpLoss', () => {
  it('returns true when HP drops below 50%', () => {
    const state = makeState({
      player: {
        x: 10, y: 10, hp: 7, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    });
    expect(checkHpLoss(state)).toBe(true);
  });

  it('returns false when HP is at exactly 50%', () => {
    (gameState as any).previousHp = 8;
    const state = makeState({
      player: {
        x: 10, y: 10, hp: 8, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    });
    expect(checkHpLoss(state)).toBe(false);
  });

  it('returns true when HP drops by 3+ in one turn', () => {
    (gameState as any).previousHp = 16;
    const state = makeState({
      player: {
        x: 10, y: 10, hp: 13, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    });
    expect(checkHpLoss(state)).toBe(true);
  });

  it('returns false for minor HP loss (< 3)', () => {
    (gameState as any).previousHp = 16;
    const state = makeState({
      player: {
        x: 10, y: 10, hp: 14, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    });
    expect(checkHpLoss(state)).toBe(false);
  });
});

describe('checkStatusCondition', () => {
  it('returns true when a new condition appears', () => {
    expect(checkStatusCondition(makeState({ conditions: ['Hungry'] }))).toBe(true);
  });

  it('returns true when condition count increases', () => {
    (gameState as any).previousConditions = ['Hungry'];
    expect(checkStatusCondition(makeState({ conditions: ['Hungry', 'Blind'] }))).toBe(true);
  });

  it('returns true when a different condition replaces one (same count)', () => {
    (gameState as any).previousConditions = ['Hungry'];
    expect(checkStatusCondition(makeState({ conditions: ['Blind'] }))).toBe(true);
  });

  it('returns false when conditions are unchanged', () => {
    (gameState as any).previousConditions = ['Hungry'];
    expect(checkStatusCondition(makeState({ conditions: ['Hungry'] }))).toBe(false);
  });

  it('returns false when no conditions', () => {
    expect(checkStatusCondition(makeState({ conditions: [] }))).toBe(false);
  });
});

describe('checkMonsterAppeared', () => {
  it('returns true when a new monster name appears', () => {
    const prev = makeSnapshot({ monsters: [{ name: 'goblin', x: 5, y: 5 }] });
    const monster: MonsterEntity = { type: 'monster', x: 8, y: 8, name: 'orc', char: 'o', color: 3, pet: false };
    const state = makeState({ entities: [monster] });
    expect(checkMonsterAppeared(state, prev)).toBe(true);
  });

  it('returns false when same monsters are visible', () => {
    const prev = makeSnapshot({ monsters: [{ name: 'goblin', x: 5, y: 5 }] });
    const monster: MonsterEntity = { type: 'monster', x: 6, y: 6, name: 'goblin', char: 'g', color: 2, pet: false };
    const state = makeState({ entities: [monster] });
    expect(checkMonsterAppeared(state, prev)).toBe(false);
  });

  it('returns false with no previous snapshot', () => {
    const state = makeState();
    expect(checkMonsterAppeared(state, null)).toBe(false);
  });

  it('ignores pets', () => {
    const prev = makeSnapshot({ monsters: [] });
    const pet: MonsterEntity = { type: 'monster', x: 8, y: 8, name: 'kitten', char: 'f', color: 7, pet: true };
    const state = makeState({ entities: [pet] });
    expect(checkMonsterAppeared(state, prev)).toBe(false);
  });
});

describe('checkVisionExpansion', () => {
  it('returns true when tiles increase by threshold', () => {
    const prev = makeSnapshot({ visibleFloorTiles: 10 });
    const state = makeState({ terrain: { playerTerrain: 'ROOM', playerRoom: null, playerLit: true, nearbyRooms: [], features: [], exits: [], visibleFloorTiles: 25, darkLOSTiles: 0 } });
    expect(checkVisionExpansion(state, prev)).toBe(true);
  });

  it('returns false when increase is below threshold', () => {
    const prev = makeSnapshot({ visibleFloorTiles: 20 });
    const state = makeState({ terrain: { playerTerrain: 'ROOM', playerRoom: null, playerLit: true, nearbyRooms: [], features: [], exits: [], visibleFloorTiles: 25, darkLOSTiles: 0 } });
    expect(checkVisionExpansion(state, prev)).toBe(false);
  });

  it('returns false with no previous snapshot', () => {
    expect(checkVisionExpansion(makeState(), null)).toBe(false);
  });
});

describe('checkInventoryChange', () => {
  it('returns true when item is added', () => {
    const prev = makeSnapshot({ inventory: [{ letter: 'a', text: 'a sword' }] });
    const state = makeState({
      inventory: [
        { letter: 'a', text: 'a sword', oclass: 'WEAPON', worn: false },
        { letter: 'b', text: 'a shield', oclass: 'ARMOR', worn: false },
      ],
    });
    expect(checkInventoryChange(state, prev)).toBe(true);
  });

  it('returns true when item text changes', () => {
    const prev = makeSnapshot({ inventory: [{ letter: 'a', text: 'a sword' }] });
    const state = makeState({
      inventory: [{ letter: 'a', text: 'a blessed sword', oclass: 'WEAPON', worn: false }],
    });
    expect(checkInventoryChange(state, prev)).toBe(true);
  });

  it('returns false when inventory is unchanged', () => {
    const prev = makeSnapshot({ inventory: [{ letter: 'a', text: 'a sword' }] });
    const state = makeState({
      inventory: [{ letter: 'a', text: 'a sword', oclass: 'WEAPON', worn: false }],
    });
    expect(checkInventoryChange(state, prev)).toBe(false);
  });

  it('returns false with no previous snapshot', () => {
    expect(checkInventoryChange(makeState(), null)).toBe(false);
  });
});

describe('shouldTriggerNarration', () => {
  it('returns true when gameMessages trigger is on and messages exist', () => {
    const config = allOnConfig();
    expect(shouldTriggerNarration(makeState(), config, null, ['You hit the goblin!'])).toBe(true);
  });

  it('returns false when all triggers are off', () => {
    const config: NarrationTriggerConfig = { triggers: { ...PRESETS.off }, activePreset: 'off', ignoredMessagePatterns: [] };
    const state = makeState({ messages: ['You hit the goblin!'], conditions: ['Hungry'], dlvl: 2 });
    expect(shouldTriggerNarration(state, config, null, ['You hit the goblin!'])).toBe(false);
  });

  it('returns true for state-only trigger even without messages', () => {
    const config: NarrationTriggerConfig = {
      triggers: { ...PRESETS.off, levelChange: true },
      activePreset: 'custom',
      ignoredMessagePatterns: [],
    };
    const state = makeState({ dlvl: 2 });
    expect(shouldTriggerNarration(state, config, null, [])).toBe(true);
  });

  it('returns false when only gameMessages is on but no messages', () => {
    const config: NarrationTriggerConfig = {
      triggers: { ...PRESETS.off, gameMessages: true },
      activePreset: 'custom',
      ignoredMessagePatterns: [],
    };
    expect(shouldTriggerNarration(makeState(), config, null, [])).toBe(false);
  });

  it('respects individual trigger toggles', () => {
    const config: NarrationTriggerConfig = {
      triggers: { ...PRESETS.off, hpLoss: true },
      activePreset: 'custom',
      ignoredMessagePatterns: [],
    };
    (gameState as any).previousHp = 16;
    const state = makeState({
      player: {
        x: 10, y: 10, hp: 5, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    });
    expect(shouldTriggerNarration(state, config, null, [])).toBe(true);
  });

  it('suppresses gameMessages when all messages match ignored patterns', () => {
    const config: NarrationTriggerConfig = {
      triggers: { ...PRESETS.off, gameMessages: true },
      activePreset: 'custom',
      ignoredMessagePatterns: ['You swap places with *'],
    };
    expect(shouldTriggerNarration(makeState(), config, null, ['You swap places with your kitten.'])).toBe(false);
  });

  it('fires gameMessages when at least one message is not ignored', () => {
    const config: NarrationTriggerConfig = {
      triggers: { ...PRESETS.off, gameMessages: true },
      activePreset: 'custom',
      ignoredMessagePatterns: ['You swap places with *'],
    };
    expect(shouldTriggerNarration(makeState(), config, null, [
      'You swap places with your kitten.',
      'You hit the goblin!',
    ])).toBe(true);
  });
});

describe('patternToRegex', () => {
  it('matches exact strings', () => {
    expect(patternToRegex('hello').test('hello')).toBe(true);
    expect(patternToRegex('hello').test('hello world')).toBe(false);
  });

  it('supports * wildcard', () => {
    expect(patternToRegex('You swap places with *').test('You swap places with your kitten.')).toBe(true);
    expect(patternToRegex('You swap places with *').test('You hit the goblin!')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(patternToRegex('you swap *').test('You swap places.')).toBe(true);
  });

  it('escapes regex special characters', () => {
    expect(patternToRegex('price is $5.00').test('price is $5.00')).toBe(true);
    expect(patternToRegex('price is $5.00').test('price is X5X00')).toBe(false);
  });
});

describe('matchesIgnoredPattern', () => {
  it('returns true if message matches any pattern', () => {
    const patterns = ['You swap places with *', 'You see here *'];
    expect(matchesIgnoredPattern('You swap places with your dog.', patterns)).toBe(true);
    expect(matchesIgnoredPattern('You see here a dagger.', patterns)).toBe(true);
  });

  it('returns false if message matches no pattern', () => {
    const patterns = ['You swap places with *'];
    expect(matchesIgnoredPattern('You hit the goblin!', patterns)).toBe(false);
  });

  it('returns false for empty pattern list', () => {
    expect(matchesIgnoredPattern('anything', [])).toBe(false);
  });
});

describe('checkGameMessages', () => {
  it('returns true when messages exist and none are ignored', () => {
    expect(checkGameMessages(['You hit the goblin!'], [])).toBe(true);
  });

  it('returns false when all messages are ignored', () => {
    expect(checkGameMessages(
      ['You swap places with your kitten.'],
      ['You swap places with *'],
    )).toBe(false);
  });

  it('returns true when at least one message survives filtering', () => {
    expect(checkGameMessages(
      ['You swap places with your kitten.', 'The goblin hits!'],
      ['You swap places with *'],
    )).toBe(true);
  });

  it('returns false for empty messages', () => {
    expect(checkGameMessages([], [])).toBe(false);
  });
});
