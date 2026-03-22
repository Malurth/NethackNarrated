import { describe, it, expect, beforeEach } from 'vitest';
import { gameState } from './game.svelte';
import type { GameState } from '../types/game';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    type: 'state',
    turn: 1,
    dlvl: 1,
    map: ['---', '|.|', '---'],
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
    role: 'Valkyrie',
    race: 'Human',
    gender: 'Female',
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

beforeEach(() => {
  // Reset the singleton to a clean state
  gameState.runtimeVersion = '3.7';
  gameState.turn = 0;
  gameState.dlvl = 0;
  gameState.map = [];
  gameState.player = null;
  gameState.messages = [];
  gameState.messageHistory = [];
  gameState.inventory = [];
  gameState.conditions = [];
  gameState.nameTitle = '';
  gameState.role = '';
  gameState.race = '';
  gameState.gender = '';
  gameState.alignment = '';
  gameState.entities = [];
  gameState.cursor = { x: 0, y: 0 };
  gameState.awaitingInput = false;
  gameState.inputType = null;
  gameState.prompt = '';
  gameState.promptChoices = '';
  gameState.menuItems = [];
  gameState.menuSelectionMode = null;
  gameState.gameOver = false;
  gameState.gameOverReason = '';
  gameState.lastAction = null;
  gameState.introText = [];
  gameState.previousTurn = 0;
  gameState.previousDlvl = 0;
  gameState.previousHp = 0;
  gameState.previousConditions = [];
});

describe('GameStore.update', () => {
  it('populates all fields from a GameState', () => {
    const state = makeState({
      turn: 5,
      dlvl: 3,
      messages: ['Hello!'],
      conditions: ['Hungry'],
      name_title: 'Hero the Valiant',
      alignment: 'chaotic',
    });

    gameState.update(state);

    expect(gameState.turn).toBe(5);
    expect(gameState.dlvl).toBe(3);
    expect(gameState.map).toEqual(['---', '|.|', '---']);
    expect(gameState.player?.hp).toBe(16);
    expect(gameState.messages).toEqual(['Hello!']);
    expect(gameState.conditions).toEqual(['Hungry']);
    expect(gameState.nameTitle).toBe('Hero the Valiant');
    expect(gameState.alignment).toBe('chaotic');
    expect(gameState.cursor).toEqual({ x: 10, y: 10 });
    expect(gameState.awaitingInput).toBe(false);
    expect(gameState.gameOver).toBe(false);
  });

  it('saves previous state before overwriting', () => {
    // Set up initial state
    gameState.update(makeState({ turn: 1, dlvl: 1 }));

    // Update to new state
    gameState.update(makeState({ turn: 2, dlvl: 2 }));

    expect(gameState.previousTurn).toBe(1);
    expect(gameState.previousDlvl).toBe(1);
  });

  it('saves previousHp from current player before overwriting', () => {
    gameState.update(makeState({
      player: {
        x: 10, y: 10, hp: 16, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 1, dlvl: 1,
      },
    }));

    gameState.update(makeState({
      player: {
        x: 10, y: 10, hp: 10, max_hp: 16, pw: 4, max_pw: 4,
        ac: 10, str: 16, dex: 12, con: 16, int: 8, wis: 8, cha: 8,
        xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 2, dlvl: 1,
      },
    }));

    expect(gameState.previousHp).toBe(16);
  });

  it('saves previousHp as 0 when player was null', () => {
    // player starts as null (no prior update)
    gameState.update(makeState());
    expect(gameState.previousHp).toBe(0);
  });

  it('snapshots previousConditions as a copy', () => {
    gameState.update(makeState({ conditions: ['Hungry'] }));
    gameState.update(makeState({ conditions: ['Hungry', 'Blind'] }));

    // previousConditions should be a snapshot, not a reference
    expect(gameState.previousConditions).toEqual(['Hungry']);
    expect(gameState.conditions).toEqual(['Hungry', 'Blind']);
  });

  it('accumulates messages into messageHistory', () => {
    gameState.update(makeState({ messages: ['You hit the goblin!'] }));
    gameState.update(makeState({ messages: ['The goblin dies!'] }));

    expect(gameState.messageHistory).toEqual([
      'You hit the goblin!',
      'The goblin dies!',
    ]);
  });

  it('does not append to messageHistory when messages are empty', () => {
    gameState.update(makeState({ messages: ['First message'] }));
    gameState.update(makeState({ messages: [] }));

    expect(gameState.messageHistory).toEqual(['First message']);
  });

  it('updates prompt and menu fields', () => {
    const state = makeState({
      awaiting_input: true,
      input_type: 'menu',
      prompt: 'What do you want to eat?',
      prompt_choices: 'abc',
      menu_items: [{ menuChar: 'a', text: 'a food ration', isSelectable: true }],
      menu_selection_mode: 1,
    });

    gameState.update(state);

    expect(gameState.awaitingInput).toBe(true);
    expect(gameState.inputType).toBe('menu');
    expect(gameState.prompt).toBe('What do you want to eat?');
    expect(gameState.promptChoices).toBe('abc');
    expect(gameState.menuItems).toHaveLength(1);
    expect(gameState.menuSelectionMode).toBe(1);
  });

  it('updates game over state', () => {
    gameState.update(makeState({
      game_over: true,
      game_over_reason: 'killed by a goblin',
    }));

    expect(gameState.gameOver).toBe(true);
    expect(gameState.gameOverReason).toBe('killed by a goblin');
  });
});

describe('GameStore.runtimeVersion', () => {
  it('defaults to 3.7', () => {
    expect(gameState.runtimeVersion).toBe('3.7');
  });

  it('can be set to 3.6.7', () => {
    gameState.runtimeVersion = '3.6.7';
    expect(gameState.runtimeVersion).toBe('3.6.7');
    // Reset for other tests
    gameState.runtimeVersion = '3.7';
  });
});

describe('GameStore.reset', () => {
  it('clears messageHistory and introText', () => {
    gameState.messageHistory = ['old message'];
    gameState.introText = ['Once upon a time...'];

    gameState.reset();

    expect(gameState.messageHistory).toEqual([]);
    expect(gameState.introText).toEqual([]);
  });

  it('clears all previous-state snapshot fields', () => {
    gameState.previousTurn = 5;
    gameState.previousDlvl = 3;
    gameState.previousHp = 12;
    gameState.previousConditions = ['Blind'];

    gameState.reset();

    expect(gameState.previousTurn).toBe(0);
    expect(gameState.previousDlvl).toBe(0);
    expect(gameState.previousHp).toBe(0);
    expect(gameState.previousConditions).toEqual([]);
  });

  it('does not clear current game state fields', () => {
    gameState.update(makeState({ turn: 10, dlvl: 5 }));
    gameState.reset();

    // Current state should be untouched by reset
    expect(gameState.turn).toBe(10);
    expect(gameState.dlvl).toBe(5);
  });
});
