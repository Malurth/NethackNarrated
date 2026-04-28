import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasNarratableContent, filterMessages, describeAction, computeDiff, captureSnapshot, narrate, analyze, resetNarrationState, maybeNarrate, buildMiniMap, saveNarrationStateForSlot, loadNarrationStateForSlot, clearNarrationStateForSlot, formatNarrationHistoryEntry, formatNarrationHistory, buildCurrentStateBlock, buildThisTurnBlock, buildSystemInstructions, NARRATION_HISTORY_LIMIT, getNarrationQueueState, resetNarrationQueue, friendlyConditionName, friendlyConditionList, friendlyPropertyName, friendlyPropertyList, SeenRegistry, seenRegistry } from './llm-service';
import { gameState } from '../state/game.svelte';
import { llmState } from '../state/llm.svelte';
import type { GameState, MonsterEntity } from '../types/game';
import { itemDisplayName } from '../types/game';
import { uiState } from '../state/ui.svelte';
import type { LLMEntry } from '../types/llm';

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
    text_window_lines: [],
    game_over: false,
    game_over_reason: '',
    ...overrides,
  };
}

function makeTerrain(overrides: Partial<NonNullable<GameState['terrain']>> = {}): NonNullable<GameState['terrain']> {
  return {
    playerTerrain: 'ROOM',
    playerRoom: null,
    playerLit: true,
    nearbyRooms: [],
    features: [],
    exits: [],
    visibleFloorTiles: 0,
    darkLOSTiles: 0,
    ...overrides,
  };
}

describe('filterMessages', () => {
  it('passes through normal game messages', () => {
    const result = filterMessages(['You hit the grid bug!', 'The grid bug is killed!']);
    expect(result).toEqual(['You hit the grid bug!', 'The grid bug is killed!']);
  });

  it('filters out prompt-matching messages', () => {
    const result = filterMessages(
      ['What do you want to eat?'],
      'What do you want to eat?',
    );
    expect(result).toEqual([]);
  });

  it('filters out position selection instructions', () => {
    expect(filterMessages(['Move cursor to the desired location:'])).toEqual([]);
    expect(filterMessages(['Pick a monster, object or location.'])).toEqual([]);
    expect(filterMessages(['Pick an object.'])).toEqual([]);
    expect(filterMessages(['Please move the cursor to a location.'])).toEqual([]);
  });

  it('filters out direction/destination prompts', () => {
    expect(filterMessages(['In what direction?'])).toEqual([]);
    expect(filterMessages(['Where do you want to jump?'])).toEqual([]);
    expect(filterMessages(['Where do you want to cast the spell?'])).toEqual([]);
    expect(filterMessages(['Where do you and Shadowfax want to be teleported?'])).toEqual([]);
  });

  it('filters out item selection instructions', () => {
    expect(filterMessages(['Choose an item; use ESC to decline.'])).toEqual([]);
    expect(filterMessages(['Select an inventory slot letter.'])).toEqual([]);
  });

  it('filters out misc UI instructions', () => {
    expect(filterMessages(['Done.'])).toEqual([]);
    expect(filterMessages(['(For instructions type a \'?\')'])).toEqual([]);
    expect(filterMessages(['Bind which key? '])).toEqual([]);
  });

  it('preserves real messages that start similarly', () => {
    // "You pick up" should NOT be caught by the "Pick a/an" pattern
    expect(filterMessages(['You pick up a dagger.'])).toEqual(['You pick up a dagger.']);
    // "Where do you think you're going?" is a game message
    expect(filterMessages(['You move north.'])).toEqual(['You move north.']);
  });

  it('filters instructions while keeping real messages', () => {
    const result = filterMessages([
      'You see here a fountain.',
      'Done.',
    ]);
    expect(result).toEqual(['You see here a fountain.']);
  });

  it('filters empty/whitespace messages', () => {
    expect(filterMessages(['', '  '])).toEqual([]);
  });
});

describe('hasNarratableContent', () => {
  it('returns false when there are no messages', () => {
    const state = makeState({ messages: [] });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns true for normal game messages with no prompt', () => {
    const state = makeState({
      messages: ['You hit the grid bug!', 'The grid bug is killed!'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });

  it('returns false when the only message matches the prompt text', () => {
    const state = makeState({
      messages: ['Move cursor to a monster, object or location:'],
      prompt: 'Move cursor to a monster, object or location:',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns true when real messages exist alongside a prompt', () => {
    const state = makeState({
      messages: ['You see here a dagger.', 'Pick up what?'],
      prompt: 'Pick up what?',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });

  it('handles whitespace differences between prompt and messages', () => {
    const state = makeState({
      messages: ['  Move cursor to a monster, object or location:  '],
      prompt: 'Move cursor to a monster, object or location:',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns true for YAFM / flavor messages with no prompt', () => {
    const state = makeState({
      messages: ['You hear the chime of a strident bell.'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });

  it('returns true for combat messages during a yn prompt', () => {
    const state = makeState({
      messages: ['The gnome hits you!', 'Really attack the gnome?'],
      prompt: 'Really attack the gnome?',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });

  it('returns false for menu prompt with only prompt message', () => {
    const state = makeState({
      messages: ['What do you want to eat?'],
      prompt: 'What do you want to eat?',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  // UI instruction filtering (no prompt set)
  it('returns false for farlook instruction with empty prompt', () => {
    const state = makeState({
      messages: ['Pick a monster, object or location.'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns false for cursor movement instruction with empty prompt', () => {
    const state = makeState({
      messages: ['Move cursor to the desired location:'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns false for direction prompt with empty prompt', () => {
    const state = makeState({
      messages: ['In what direction?'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns false for destination prompt with empty prompt', () => {
    const state = makeState({
      messages: ['Where do you want to jump?'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(false);
  });

  it('returns true when real messages exist alongside UI instructions', () => {
    const state = makeState({
      messages: ['The gnome hits you!', 'In what direction?'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });

  it('returns true for messages that look similar but are not instructions', () => {
    const state = makeState({
      messages: ['You pick up a dagger.'],
      prompt: '',
    });
    expect(hasNarratableContent(state)).toBe(true);
  });
});

describe('describeAction', () => {
  it('returns empty string for null action', () => {
    expect(describeAction(null, 10, 10)).toBe('');
  });

  it('describes move actions', () => {
    expect(describeAction({ action: 'move', direction: 'north' }, 10, 10)).toBe('move north');
  });

  it('returns empty for prompt responses', () => {
    expect(describeAction({ action: 'answer', key: 'y' }, 10, 10)).toBe('');
    expect(describeAction({ action: 'menuSelect', key: 'a' }, 10, 10)).toBe('');
    expect(describeAction({ action: 'menuDismiss' }, 10, 10)).toBe('');
  });

  it('returns empty for raw keystrokes', () => {
    expect(describeAction({ action: 'key', key: 'x' }, 10, 10)).toBe('');
  });

  it('describes named actions without item or direction', () => {
    expect(describeAction({ action: 'search' }, 10, 10)).toBe('search');
    expect(describeAction({ action: 'pickup' }, 10, 10)).toBe('pickup');
  });

  it('describes directional actions', () => {
    expect(describeAction({ action: 'kick', direction: 'north' }, 10, 10)).toBe('kick north');
  });

  it('includes item letter when no itemName provided', () => {
    expect(describeAction({ action: 'read', item: 'g' }, 10, 10)).toBe('read item g');
  });

  it('includes full item name when itemName is present', () => {
    expect(describeAction({ action: 'read', item: 'g', itemName: 'a scroll of identify' }, 10, 10))
      .toBe('read item g (a scroll of identify)');
    expect(describeAction({ action: 'eat', item: 'h', itemName: 'an uncursed food ration' }, 10, 10))
      .toBe('eat item h (an uncursed food ration)');
  });

  it('falls back to just the letter when itemName is missing', () => {
    expect(describeAction({ action: 'wield', item: 'z' }, 10, 10)).toBe('wield item z');
  });
});

describe('computeDiff — inventory changes', () => {
  const base = makeState({
    turn: 1,
    inventory: [
      { letter: 'a', text: 'a +0 long sword (weapon in hand)', oclass: 'weapon', worn: true },
      { letter: 'b', text: '10 uncursed food rations', oclass: 'food', worn: false },
      { letter: 'c', text: 'an uncursed scroll of identify', oclass: 'scroll', worn: false },
    ],
  });

  it('detects item quantity change (stack consumed)', () => {
    const prev = captureSnapshot(base);
    const next = makeState({
      ...base,
      turn: 2,
      inventory: [
        { letter: 'a', text: 'a +0 long sword (weapon in hand)', oclass: 'weapon', worn: true },
        { letter: 'b', text: '9 uncursed food rations', oclass: 'food', worn: false },
        { letter: 'c', text: 'an uncursed scroll of identify', oclass: 'scroll', worn: false },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Inventory b: 10 uncursed food rations → 9 uncursed food rations');
  });

  it('detects item gained', () => {
    const prev = captureSnapshot(base);
    const next = makeState({
      ...base,
      turn: 2,
      inventory: [
        ...base.inventory,
        { letter: 'd', text: 'a dagger', oclass: 'weapon', worn: false },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Gained inventory d: a dagger');
  });

  it('detects item lost (fully consumed)', () => {
    const prev = captureSnapshot(base);
    const next = makeState({
      ...base,
      turn: 2,
      inventory: [
        { letter: 'a', text: 'a +0 long sword (weapon in hand)', oclass: 'weapon', worn: true },
        { letter: 'b', text: '10 uncursed food rations', oclass: 'food', worn: false },
        // scroll of identify consumed
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Lost inventory c: an uncursed scroll of identify');
  });

  it('detects equip state change', () => {
    const prev = captureSnapshot(makeState({
      turn: 1,
      inventory: [
        { letter: 'a', text: 'a +0 long sword', oclass: 'weapon', worn: false },
      ],
    }));
    const next = makeState({
      turn: 2,
      inventory: [
        { letter: 'a', text: 'a +0 long sword (weapon in hand)', oclass: 'weapon', worn: true },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Inventory a: a +0 long sword → a +0 long sword (weapon in hand)');
  });

  it('reports no inventory changes when nothing changed', () => {
    const prev = captureSnapshot(base);
    const next = makeState({ ...base, turn: 2 });
    const diff = computeDiff(prev, next);
    const invLines = diff.filter(l => l.includes('nventory'));
    expect(invLines).toEqual([]);
  });
});

describe('computeDiff — creature movement', () => {
  function monster(name: string, x: number, y: number, m_id?: number): MonsterEntity {
    return { type: 'monster', name, x, y, char: 'x', color: 0, pet: false, ...(m_id ? { m_id } : {}) };
  }
  function pet(name: string, x: number, y: number, m_id?: number): MonsterEntity {
    return { type: 'monster', name, x, y, char: 'd', color: 0, pet: true, ...(m_id ? { m_id } : {}) };
  }

  beforeEach(() => {
    resetNarrationState(); // reset seen registry between tests
  });

  it('does not report the player as a moving monster (regression)', () => {
    // wasm-connection adds the player to state.entities as a monster named
    // "you" at the player's tile so MapDisplay can render the @. That
    // entity must NEVER appear in the monster diff — otherwise every turn
    // the player moves produces "The you moved closer (now here)".
    const prev = captureSnapshot(makeState({
      turn: 1,
      player: { ...makeState().player, x: 10, y: 10 },
      entities: [monster('you', 10, 10)],
    }));
    const next = makeState({
      turn: 2,
      player: { ...makeState().player, x: 11, y: 10 },
      entities: [monster('you', 11, 10)],
    });
    const diff = computeDiff(prev, next);
    expect(diff.filter(l => l.toLowerCase().includes('you'))).toEqual([]);
  });

  it('reports monster appearance with relative position', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const next = makeState({ turn: 2, entities: [monster('grid bug', 14, 10)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('A grid bug is here for the first time (4 tiles east)');
  });

  it('reports a 1-tile monster move toward the player (regression)', () => {
    // Previously silent: the threshold was "delta >= 2 tiles".
    const prev = captureSnapshot(makeState({ turn: 1, entities: [monster('grid bug', 14, 10)] }));
    const next = makeState({ turn: 2, entities: [monster('grid bug', 13, 10)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('The grid bug moved closer (now 3 tiles east)');
  });

  it('reports a 1-tile monster move away from the player', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [monster('grid bug', 13, 10)] }));
    const next = makeState({ turn: 2, entities: [monster('grid bug', 14, 10)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('The grid bug moved away (now 4 tiles east)');
  });

  it('reports sideways movement when player-distance is unchanged', () => {
    // Player at (10,10). Grid bug at (13,10) — 3 tiles east. Then it
    // shuffles to (13,11) — still Chebyshev 3, but a real position change.
    const prev = captureSnapshot(makeState({ turn: 1, entities: [monster('grid bug', 13, 10)] }));
    const next = makeState({ turn: 2, entities: [monster('grid bug', 13, 11)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('The grid bug shifted (now 3 tiles south-east)');
  });

  it('reports no movement line when a monster does not move', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [monster('grid bug', 14, 10)] }));
    const next = makeState({ turn: 2, entities: [monster('grid bug', 14, 10)] });
    const diff = computeDiff(prev, next);
    expect(diff.filter(l => l.includes('grid bug'))).toEqual([]);
  });

  it('reports monster disappearance', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [monster('grid bug', 14, 10)] }));
    const next = makeState({ turn: 2, entities: [] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('The grid bug is no longer visible');
  });

  it('pairs duplicate-name creatures by nearest position (not just first-by-name)', () => {
    // Two grid bugs: one stationary at (14,10), one moving from (5,10)→(6,10).
    // Old code used Map<name, m> and would keep only one of them, mis-reporting
    // that the "grid bug" moved from 14 to 6 (or treating one as disappeared).
    const prev = captureSnapshot(makeState({
      turn: 1,
      entities: [monster('grid bug', 14, 10), monster('grid bug', 5, 10)],
    }));
    const next = makeState({
      turn: 2,
      entities: [monster('grid bug', 14, 10), monster('grid bug', 6, 10)],
    });
    const diff = computeDiff(prev, next);

    // The stationary grid bug at (14,10) produces no movement line.
    // The moving grid bug from (5,10)→(6,10) produces one movement line —
    // it moved closer to the player at (10,10) (from 5 tiles to 4 tiles west).
    const moveLines = diff.filter(l => l.includes('grid bug') && l.includes('moved'));
    expect(moveLines).toHaveLength(1);
    expect(moveLines[0]).toContain('moved closer');
    expect(moveLines[0]).toContain('4 tiles west');
  });

  it('reports pet movement', () => {
    // Previously pets had no movement diff at all — only appear/disappear.
    // Pony at (12,10) = 2 tiles east, then moves to (11,10) = adjacent east.
    const prev = captureSnapshot(makeState({ turn: 1, entities: [pet('saddled pony', 12, 10)] }));
    const next = makeState({ turn: 2, entities: [pet('saddled pony', 11, 10)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Your pet saddled pony moved closer (now adjacent east)');
  });

  it('reports pet appearance and disappearance', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const next = makeState({ turn: 2, entities: [pet('saddled pony', 11, 10)] });
    const diffAppear = computeDiff(prev, next);
    expect(diffAppear).toContain('Your pet saddled pony appeared for the first time (adjacent east)');

    const prev2 = captureSnapshot(makeState({ turn: 2, entities: [pet('saddled pony', 11, 10)] }));
    const next2 = makeState({ turn: 3, entities: [] });
    const diffGone = computeDiff(prev2, next2);
    expect(diffGone).toContain('Your pet saddled pony is no longer visible');
  });

  // ─── Level-transition diff handling ──────────────────────────────
  // prev and curr live in different coordinate spaces across a stairs
  // transition. The position-based diff machinery would mis-match
  // same-named creatures and emit contradictory "appeared" + "no
  // longer visible" pairs, falsely report player "Moved" for the
  // teleport, and spam item/feature diff lines for everything on
  // both levels. All of that is gated off; pets get a special
  // name-only matcher to detect followers.

  it('pet that follows through stairs emits "followed you", not appeared + gone (regression)', () => {
    // Exact repro of the user bug: pet adjacent on dlvl 1, player
    // descends, pet is adjacent on dlvl 2 (at totally different
    // coordinates because it's a different level). The old
    // position-based diffCreatures code emitted BOTH
    // "Your pet kitten appeared (adjacent north)" AND
    // "Your pet kitten is no longer visible" in the same diff.
    const prev = captureSnapshot(makeState({
      turn: 200,
      dlvl: 1,
      player: { ...makeState().player, x: 20, y: 5, dlvl: 1 },
      entities: [pet('kitten', 20, 6)], // adjacent south on dlvl 1
    }));
    const next = makeState({
      turn: 201,
      dlvl: 2,
      player: { ...makeState().player, x: 36, y: 9, dlvl: 2 },
      entities: [pet('kitten', 36, 8)], // adjacent north on dlvl 2
    });
    const diff = computeDiff(prev, next);

    // The transition line is present…
    expect(diff).toContain('Descended to dungeon level 2');
    // …the pet follow line is emitted with position relative to the
    // NEW player position…
    expect(diff).toContain('Your pet kitten followed you (now adjacent north)');
    // …and NEITHER of the old spurious lines appears.
    expect(diff.filter(l => l.includes('kitten') && l.includes('appeared'))).toEqual([]);
    expect(diff.filter(l => l.includes('kitten') && l.includes('is no longer visible'))).toEqual([]);
  });

  it('pet that fails to follow emits "did not follow you"', () => {
    // Pet was present on dlvl 1 but not on dlvl 2 (wasn't adjacent
    // when the player stepped on the stairs, or got stuck).
    const prev = captureSnapshot(makeState({
      turn: 100,
      dlvl: 2,
      player: { ...makeState().player, x: 20, y: 5, dlvl: 2 },
      entities: [pet('kitten', 15, 5)], // too far to follow
    }));
    const next = makeState({
      turn: 101,
      dlvl: 3,
      player: { ...makeState().player, x: 10, y: 10, dlvl: 3 },
      entities: [], // no pet on dlvl 3
    });
    const diff = computeDiff(prev, next);

    expect(diff).toContain('Descended to dungeon level 3');
    expect(diff).toContain('Your pet kitten did not follow you');
    // No "is no longer visible" — that wording is reserved for
    // within-level disappearances.
    expect(diff.filter(l => l.includes('is no longer visible'))).toEqual([]);
  });

  it('monster diff is suppressed on level change', () => {
    // A grid bug on the old level should NOT become "no longer visible"
    // (the player just left the level) and a kobold on the new level
    // should NOT become "appeared" (it's unrelated to the old level's
    // monster list). The CURRENT STATE block shows both to the LLM.
    const prev = captureSnapshot(makeState({
      turn: 50,
      dlvl: 1,
      player: { ...makeState().player, x: 10, y: 10, dlvl: 1 },
      entities: [monster('grid bug', 13, 10)],
    }));
    const next = makeState({
      turn: 51,
      dlvl: 2,
      player: { ...makeState().player, x: 30, y: 15, dlvl: 2 },
      entities: [monster('kobold', 32, 15)],
    });
    const diff = computeDiff(prev, next);

    expect(diff).toContain('Descended to dungeon level 2');
    // No per-monster appear/gone lines.
    expect(diff.filter(l => l.includes('grid bug'))).toEqual([]);
    expect(diff.filter(l => l.includes('kobold'))).toEqual([]);
  });

  it('player "Moved" line is suppressed on level change (stairs are teleportation)', () => {
    // The player's (x,y) differs between levels because they're in
    // different coordinate spaces — but the "Descended" line already
    // covers the movement, so the position-delta "Moved" line would
    // be a duplicate at best and misleading at worst.
    const prev = captureSnapshot(makeState({
      turn: 50,
      dlvl: 1,
      player: { ...makeState().player, x: 10, y: 10, dlvl: 1 },
    }));
    const next = makeState({
      turn: 51,
      dlvl: 2,
      player: { ...makeState().player, x: 40, y: 20, dlvl: 2 },
    });
    const diff = computeDiff(prev, next);

    expect(diff).toContain('Descended to dungeon level 2');
    expect(diff.filter(l => l.startsWith('Moved '))).toEqual([]);
  });

  it('item and feature diff is suppressed on level change', () => {
    // Items on the old level aren't "gone" — the player just left
    // them behind. Features on the new level aren't "discoveries" —
    // they're unrelated to the old level's feature set.
    const prev = captureSnapshot(makeState({
      turn: 50,
      dlvl: 1,
      player: { ...makeState().player, x: 10, y: 10, dlvl: 1 },
      entities: [
        { type: 'item', x: 12, y: 10, category: 'weapon', char: ')', color: 7, name: 'long sword' },
      ],
      terrain: makeTerrain({
        features: [{ name: 'fountain', x: 14, y: 10, inSight: true }],
      }),
    }));
    const next = makeState({
      turn: 51,
      dlvl: 2,
      player: { ...makeState().player, x: 30, y: 15, dlvl: 2 },
      entities: [
        { type: 'item', x: 32, y: 15, category: 'scroll', char: '?', color: 15, name: 'scroll' },
      ],
      terrain: makeTerrain({
        features: [{ name: 'altar', x: 34, y: 15, inSight: true }],
      }),
    });
    const diff = computeDiff(prev, next);

    expect(diff).toContain('Descended to dungeon level 2');
    // No old-level item "no longer on the floor" line.
    expect(diff.filter(l => l.includes('long sword'))).toEqual([]);
    // No old-level feature diff.
    expect(diff.filter(l => l.includes('fountain'))).toEqual([]);
    // No new-level item discovery.
    expect(diff.filter(l => l.includes('scroll'))).toEqual([]);
    // No new-level feature discovery.
    expect(diff.filter(l => l.includes('altar'))).toEqual([]);
  });

  it('inventory / HP / condition diffs still fire across level change', () => {
    // These are level-agnostic — a trap door descent can damage you,
    // consume food, remove conditions, etc. All should still report.
    const prev = captureSnapshot(makeState({
      turn: 50,
      dlvl: 1,
      player: { ...makeState().player, hp: 18, max_hp: 20, dlvl: 1, hunger: 'Not Hungry' },
      conditions: ['levitating'],
      inventory: [
        { letter: 'a', text: 'a +1 long sword', oclass: 'weapon', worn: true },
      ],
    }));
    const next = makeState({
      turn: 51,
      dlvl: 2,
      player: { ...makeState().player, hp: 10, max_hp: 20, dlvl: 2, hunger: 'Hungry' },
      conditions: [],
      inventory: [
        { letter: 'a', text: 'a +1 long sword', oclass: 'weapon', worn: true },
        { letter: 'b', text: 'a scroll of fire', oclass: 'scroll', worn: false },
      ],
    });
    const diff = computeDiff(prev, next);

    expect(diff).toContain('Descended to dungeon level 2');
    expect(diff.some(l => l.includes('Lost 8 HP'))).toBe(true);
    expect(diff).toContain('Hunger: Not Hungry → Hungry');
    expect(diff).toContain('No longer levitating');
    expect(diff).toContain('Gained inventory b: a scroll of fire');
  });
});

describe('computeDiff — item and feature discovery', () => {
  beforeEach(() => {
    resetNarrationState();
  });

  it('reports discovered floor items with discovery wording and does not double-report terrain features', () => {
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain({
        features: [{ name: 'fountain', x: 4, y: 10, inSight: true }],
      }),
      entities: [
        { type: 'item', name: 'statue of bugbear', category: 'statue of bugbear', x: 5, y: 5, char: '`', color: 0 },
        { type: 'item', name: 'gold', category: 'gold', x: 7, y: 13, char: '$', color: 0 },
        // wasm-connection duplicates visible features into entities for the legend;
        // narration should treat this as a terrain feature, not a floor item.
        { type: 'item', name: 'fountain', category: 'fountain', x: 4, y: 10, char: '{', color: 0 },
      ],
    });

    const diff = computeDiff(prev, next);

    expect(diff).toContain('Discovered statue of bugbear (5 tiles north-west) [new]');
    expect(diff).toContain('Discovered gold (3 tiles south-west) [new]');
    expect(diff).toContain('Discovered fountain (6 tiles west) [new]');
    expect(diff.filter(l => l === 'Discovered fountain (6 tiles west) [new]')).toHaveLength(1);
    expect(diff.join('\n')).not.toContain('on the floor');
  });

  it('emits "Identified" when an item with the same o_id changes name', () => {
    // Item name changes (e.g. scroll identification, or name update) — same o_id
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a scroll labeled ZELGO MER', category: 'scroll', x: 15, y: 10, char: '?', color: 0, o_id: 47 },
      ],
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a scroll of identify', category: 'scroll', x: 15, y: 10, char: '?', color: 0, o_id: 47 },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Identified: the a scroll labeled ZELGO MER is actually a scroll of identify (5 tiles east)');
    expect(diff.join('\n')).not.toContain('no longer on the floor');
    expect(diff.join('\n')).not.toContain('Discovered');
  });

  it('does not emit "Identified" when o_id matches and name is unchanged', () => {
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47 },
      ],
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47 },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff.join('\n')).not.toContain('Identified');
    expect(diff.join('\n')).not.toContain('box');
  });

  it('reports genuine item replacement when o_ids differ at the same position', () => {
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'tool', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47 },
      ],
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'chest', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 99 },
      ],
    });
    const diff = computeDiff(prev, next);
    // Different o_ids → genuinely different objects
    expect(diff.join('\n')).not.toContain('Identified');
    expect(diff).toContain('The tool is no longer on the floor nearby');
    expect(diff.some(l => l.includes('chest') && l.includes('Discovered'))).toBe(true);
  });

  it('falls back to name@position matching for items without o_id', () => {
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'gold', category: 'gold', x: 7, y: 13, char: '$', color: 0 },
      ],
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'gold', category: 'gold', x: 7, y: 13, char: '$', color: 0 },
      ],
    });
    const diff = computeDiff(prev, next);
    // Same name@position, no o_id — should not report anything about gold
    expect(diff.join('\n')).not.toContain('gold');
  });
});

describe('itemDisplayName and explore mode', () => {
  afterEach(() => {
    uiState.itemDetailMode = 'immediate';
  });

  it('immediate mode always shows the real name', () => {
    uiState.itemDetailMode = 'immediate';
    expect(itemDisplayName({ type: 'item', x: 0, y: 0, category: 'tool', char: '(', color: 0, name: 'a large box', nameKnown: false }, 'immediate')).toBe('a large box');
  });

  it('explore mode shows category when nameKnown is false', () => {
    expect(itemDisplayName({ type: 'item', x: 0, y: 0, category: 'tool', char: '(', color: 0, name: 'a large box', nameKnown: false }, 'explore')).toBe('tool');
  });

  it('explore mode shows real name when nameKnown is true', () => {
    expect(itemDisplayName({ type: 'item', x: 0, y: 0, category: 'tool', char: '(', color: 0, name: 'a large box', nameKnown: true }, 'explore')).toBe('a large box');
  });

  it('explore mode falls back to category when name is undefined', () => {
    expect(itemDisplayName({ type: 'item', x: 0, y: 0, category: 'weapon', char: ')', color: 0 }, 'explore')).toBe('weapon');
  });

  it('explore mode snapshot uses category for unexamined items', () => {
    uiState.itemDetailMode = 'explore';
    const snap = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47, nameKnown: false },
      ],
    }));
    expect(snap.items[0].name).toBe('tool');
  });

  it('explore mode snapshot uses name for examined items', () => {
    uiState.itemDetailMode = 'explore';
    const snap = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47, nameKnown: true },
      ],
    }));
    expect(snap.items[0].name).toBe('a large box');
  });

  it('explore mode diff emits Identified when nameKnown flips', () => {
    uiState.itemDetailMode = 'explore';
    const prev = captureSnapshot(makeState({
      turn: 1,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47, nameKnown: false },
      ],
    }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [
        { type: 'item', name: 'a large box', category: 'tool', x: 15, y: 10, char: '(', color: 0, o_id: 47, nameKnown: true },
      ],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Identified: the tool is actually a large box (5 tiles east)');
  });
});

describe('SeenRegistry', () => {
  it('returns true on first sighting, false on subsequent', () => {
    const reg = new SeenRegistry();
    expect(reg.seeMonster(42, 'lichen')).toBe(true);
    expect(reg.seeMonster(42, 'lichen')).toBe(false);
  });

  it('distinguishes monsters by m_id, not just name', () => {
    const reg = new SeenRegistry();
    expect(reg.seeMonster(1, 'lichen')).toBe(true);
    expect(reg.seeMonster(2, 'lichen')).toBe(true); // different individual
    expect(reg.seeMonster(1, 'lichen')).toBe(false);
  });

  it('falls back to species-level tracking when m_id is undefined', () => {
    const reg = new SeenRegistry();
    expect(reg.seeMonster(undefined, 'lichen')).toBe(true);
    expect(reg.seeMonster(undefined, 'lichen')).toBe(false);
  });

  it('tracks items by position key scoped to dlvl', () => {
    const reg = new SeenRegistry();
    expect(reg.seeItem('scroll', 5, 10, 1)).toBe(true);
    expect(reg.seeItem('scroll', 5, 10, 1)).toBe(false);
    expect(reg.seeItem('scroll', 6, 10, 1)).toBe(true); // different location
    expect(reg.seeItem('scroll', 5, 10, 2)).toBe(true); // same position, different level
  });

  it('tracks features by key scoped to dlvl', () => {
    const reg = new SeenRegistry();
    expect(reg.seeFeature('fountain@4,10', 1)).toBe(true);
    expect(reg.seeFeature('fountain@4,10', 1)).toBe(false);
    expect(reg.seeFeature('fountain@4,10', 3)).toBe(true); // same pos, different level
  });

  it('round-trips through JSON serialization', () => {
    const reg = new SeenRegistry();
    reg.seeMonster(42, 'lichen');
    reg.seeItem('potion', 3, 7, 1);
    reg.seeFeature('staircase up@10,20', 1);

    const restored = SeenRegistry.fromJSON(reg.toJSON());
    expect(restored.hasSeenMonster(42, 'lichen')).toBe(true);
    expect(restored.hasSeenMonster(99, 'dragon')).toBe(false);
    expect(restored.seeItem('potion', 3, 7, 1)).toBe(false); // already seen
    expect(restored.seeItem('potion', 3, 7, 2)).toBe(true); // different level
    expect(restored.seeFeature('staircase up@10,20', 1)).toBe(false);
  });
});

describe('computeDiff — seen registry (object permanence)', () => {
  function monster(name: string, x: number, y: number, m_id?: number): MonsterEntity {
    return { type: 'monster', name, x, y, char: 'x', color: 0, pet: false, ...(m_id ? { m_id } : {}) };
  }

  beforeEach(() => {
    resetNarrationState();
  });

  it('reports first-time monster with "for the first time"', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const next = makeState({ turn: 2, entities: [monster('lichen', 14, 10, 42)] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('A lichen is here for the first time (4 tiles east)');
  });

  it('reports returning monster with "reappeared"', () => {
    // Turn 1→2: lichen appears
    const s1 = makeState({ turn: 1, entities: [] });
    const snap1 = captureSnapshot(s1);
    const s2 = makeState({ turn: 2, entities: [monster('lichen', 14, 10, 42)] });
    computeDiff(snap1, s2);

    // Turn 2→3: lichen disappears
    const snap2 = captureSnapshot(s2);
    const s3 = makeState({ turn: 3, entities: [] });
    computeDiff(snap2, s3);

    // Turn 3→4: same lichen (same m_id) reappears
    const snap3 = captureSnapshot(s3);
    const s4 = makeState({ turn: 4, entities: [monster('lichen', 12, 10, 42)] });
    const diff = computeDiff(snap3, s4);
    expect(diff).toContain('A lichen reappeared (2 tiles east)');
  });

  it('reports first-time item with [new] tag', () => {
    const prev = captureSnapshot(makeState({ turn: 1, terrain: makeTerrain() }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain(),
      entities: [{ type: 'item', name: 'potion', category: 'potion', x: 12, y: 10, char: '!', color: 0 }],
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Discovered potion (2 tiles east) [new]');
  });

  it('reports returning item with "visible again"', () => {
    // Item appears then disappears then reappears
    const s1 = makeState({ turn: 1, terrain: makeTerrain() });
    const snap1 = captureSnapshot(s1);
    const s2 = makeState({
      turn: 2, terrain: makeTerrain(),
      entities: [{ type: 'item', name: 'potion', category: 'potion', x: 12, y: 10, char: '!', color: 0 }],
    });
    computeDiff(snap1, s2);

    const snap2 = captureSnapshot(s2);
    const s3 = makeState({ turn: 3, terrain: makeTerrain() });
    computeDiff(snap2, s3);

    const snap3 = captureSnapshot(s3);
    const s4 = makeState({
      turn: 4, terrain: makeTerrain(),
      entities: [{ type: 'item', name: 'potion', category: 'potion', x: 12, y: 10, char: '!', color: 0 }],
    });
    const diff = computeDiff(snap3, s4);
    expect(diff).toContain('potion visible again (2 tiles east)');
  });

  it('reports first-time feature with [new] tag', () => {
    const prev = captureSnapshot(makeState({ turn: 1, terrain: makeTerrain() }));
    const next = makeState({
      turn: 2,
      terrain: makeTerrain({
        features: [{ name: 'fountain', x: 4, y: 10, inSight: true }],
      }),
    });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Discovered fountain (6 tiles west) [new]');
  });

  it('persists registry across save/load cycle', () => {
    const slotId = 'test-registry-persist';
    resetNarrationState();

    // See a lichen
    const s1 = makeState({ turn: 1, entities: [] });
    const snap1 = captureSnapshot(s1);
    const s2 = makeState({ turn: 2, entities: [monster('lichen', 14, 10, 42)] });
    computeDiff(snap1, s2);

    // Save state
    llmState.provider = 'none';
    llmState.entries = [];
    saveNarrationStateForSlot(slotId);

    // Reset and reload
    resetNarrationState();
    expect(seenRegistry.hasSeenMonster(42, 'lichen')).toBe(false); // cleared

    loadNarrationStateForSlot(slotId);
    expect(seenRegistry.hasSeenMonster(42, 'lichen')).toBe(true); // restored

    // Clean up
    clearNarrationStateForSlot(slotId);
  });

  it('aggregated diff reports "first time" even after per-turn diff already registered the entity', () => {
    // Simulate the real flow: per-turn diffs run first (mutating), then the
    // aggregated diff runs with registryOverride spanning the same range.
    // The aggregated diff must still say "first time" because the entity was
    // not in the registry at the narration baseline.

    // Narration baseline: no monsters — snapshot the registry at this point
    const narrationBaseline = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const baselineRegistry = seenRegistry.clone();

    // Turn 1→2: nothing happens
    const turnSnap1 = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const s2 = makeState({ turn: 2, entities: [] });
    computeDiff(turnSnap1, s2); // per-turn diff (mutating)

    // Turn 2→3: newt appears — per-turn diff registers it
    const turnSnap2 = captureSnapshot(s2);
    const s3 = makeState({ turn: 3, entities: [monster('newt', 13, 9, 99)] });
    const perTurnDiff = computeDiff(turnSnap2, s3); // mutating
    expect(perTurnDiff).toContain('A newt is here for the first time (3 tiles north-east)');

    // Aggregated diff using the baseline registry — newt wasn't known then
    const aggDiff = computeDiff(narrationBaseline, s3, { registryOverride: baselineRegistry });
    expect(aggDiff).toContain('A newt is here for the first time (3 tiles north-east)');
    expect(aggDiff.join('\n')).not.toContain('reappeared');
  });

  it('aggregated diff reports "reappeared" for entities already in the registry at the baseline', () => {
    // Pre-register a monster: it appears on turn 1 (registered), disappears on turn 2
    const s0 = makeState({ turn: 1, entities: [] });
    const snap0 = captureSnapshot(s0);
    const s1 = makeState({ turn: 2, entities: [monster('lichen', 14, 10, 42)] });
    computeDiff(snap0, s1); // lichen appears → registered as seen
    expect(seenRegistry.hasSeenMonster(42, 'lichen')).toBe(true);

    // Turn 2→3: lichen disappears
    const snap1 = captureSnapshot(s1);
    const s2 = makeState({ turn: 3, entities: [] });
    computeDiff(snap1, s2);

    // Narration baseline: lichen is gone — snapshot the registry (lichen IS known)
    const narrationBaseline = captureSnapshot(s2);
    const baselineRegistry = seenRegistry.clone();

    // Turn 3→4: still no lichen
    const turnSnap3 = captureSnapshot(s2);
    const s4 = makeState({ turn: 4, entities: [] });
    computeDiff(turnSnap3, s4); // mutating, no change

    // Turn 4→5: lichen reappears — per-turn diff says "reappeared" (already known)
    const turnSnap4 = captureSnapshot(s4);
    const s5 = makeState({ turn: 5, entities: [monster('lichen', 12, 10, 42)] });
    const perTurnDiff = computeDiff(turnSnap4, s5); // mutating
    expect(perTurnDiff).toContain('A lichen reappeared (2 tiles east)');

    // Aggregated diff (baseline→s5) should also say "reappeared" since the
    // lichen was already known in the baseline registry
    const aggDiff = computeDiff(narrationBaseline, s5, { registryOverride: baselineRegistry });
    expect(aggDiff).toContain('A lichen reappeared (2 tiles east)');
  });

  it('registryOverride diff does not mutate the live registry', () => {
    const prev = captureSnapshot(makeState({ turn: 1, entities: [] }));
    const next = makeState({ turn: 2, entities: [monster('jackal', 14, 10, 77)] });
    const frozenRegistry = seenRegistry.clone();

    // Diff with registryOverride should not register the jackal
    computeDiff(prev, next, { registryOverride: frozenRegistry });
    expect(seenRegistry.hasSeenMonster(77, 'jackal')).toBe(false);

    // Normal diff should register it
    computeDiff(prev, next);
    expect(seenRegistry.hasSeenMonster(77, 'jackal')).toBe(true);
  });
});

describe('narrate — prompt selection', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Use 'none' provider so no real LLM call is made
    llmState.provider = 'none';
    llmState.entries = [];
    llmState.isGenerating = false;
    llmState.currentNarration = '';
    gameState.introText = [];
    gameState.messageHistory = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function getLoggedPrompt(): string {
    const call = logSpy.mock.calls.find(c => c[0] === '[NARRATION PROMPT]');
    return call ? String(call[1]) : '';
  }

  it('uses game-start prompt for a new game (intro text present)', async () => {
    gameState.introText = ['You are a valiant warrior...'];
    const state = makeState({ messages: ['Hello adventurer!'] });
    await narrate(state);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('opening narration');
    expect(prompt).toContain('Mazes of Menace');
  });

  it('uses regular prompt on save restore (no intro text)', async () => {
    // Simulate a restore: no intro text, no prior narration entries
    gameState.introText = [];
    const state = makeState({ messages: ['Hello adventurer!'] });
    await narrate(state);

    const prompt = getLoggedPrompt();
    expect(prompt).not.toContain('OPENING narration');
    expect(prompt).toContain('Narrate what just happened');
  });

  it('uses game-start prompt for second game after resetNarrationState', async () => {
    // First game: narrate once so entries and snapshot are populated
    gameState.introText = ['You are a valiant warrior...'];
    const state1 = makeState({ messages: ['Hello adventurer!'] });
    await narrate(state1);
    expect(llmState.entries.length).toBe(1);

    // Simulate starting a new game: clear everything
    llmState.clearNarration();
    resetNarrationState();
    gameState.introText = ['A new hero descends...'];

    // Second game's first narration should use the game-start prompt
    const state2 = makeState({ messages: ['Welcome back!'] });
    await narrate(state2);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('opening narration');
    expect(prompt).toContain('Mazes of Menace');
  });

  it('resetNarrationState clears stale snapshot so diffs are clean', async () => {
    // First game: narrate to populate the snapshot
    gameState.introText = ['You are a valiant warrior...'];
    const state1 = makeState({
      messages: ['Hello!'],
      inventory: [{ letter: 'a', text: 'a +2 bullwhip', oclass: 'weapon', worn: true }],
    });
    await narrate(state1);

    // Reset for second game
    llmState.clearNarration();
    resetNarrationState();
    gameState.introText = [];
    gameState.messageHistory = [];

    // Second game with completely different inventory
    const state2 = makeState({
      messages: ['Welcome!'],
      inventory: [{ letter: 'a', text: 'a +1 mace', oclass: 'weapon', worn: true }],
    });
    // computeDiff should produce NO inventory diff (snapshot was cleared)
    const diff = computeDiff(captureSnapshot(state2), state2);
    const invLines = diff.filter(l => l.includes('nventory'));
    expect(invLines).toEqual([]);
  });
});

describe('narrate — turn log', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    llmState.provider = 'none';
    llmState.setPreset('standard');
    llmState.entries = [];
    llmState.isGenerating = false;
    llmState.currentNarration = '';
    gameState.introText = [];
    gameState.messageHistory = [];
    gameState.lastAction = null;
    gameState.actionContext = null;
    resetNarrationState();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function getLoggedPrompt(): string {
    const call = logSpy.mock.calls.find(c => c[0] === '[NARRATION PROMPT]');
    return call ? String(call[1]) : '';
  }

  it('single-turn narration uses "Player action" format', async () => {
    gameState.actionContext = {
      action: { action: 'search' },
      prompts: [],
    };
    const state = makeState({ messages: ['You find nothing.'] });
    maybeNarrate(state);
    await new Promise(r => setTimeout(r, 0));

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Player action:');
    expect(prompt).not.toContain('Actions since last narration');
  });

  it('multi-turn narration uses step-by-step log + aggregated diff', async () => {
    // Turn 1: no narration (no messages)
    gameState.actionContext = { action: { action: 'move', direction: 'south' }, prompts: [] };
    const state1 = makeState({ turn: 1, messages: [], player: { ...makeState().player, x: 10, y: 11 } });
    maybeNarrate(state1);
    // No narration (no narratable content)
    expect(getLoggedPrompt()).toBe('');

    // Turn 2: no narration (no messages)
    gameState.actionContext = { action: { action: 'move', direction: 'south' }, prompts: [] };
    const state2 = makeState({ turn: 2, messages: [], player: { ...makeState().player, x: 10, y: 12 } });
    maybeNarrate(state2);
    expect(getLoggedPrompt()).toBe('');

    // Turn 3: narration fires (has messages)
    gameState.actionContext = { action: { action: 'pickup' }, prompts: [] };
    const state3 = makeState({
      turn: 3,
      messages: ['You see a potion of healing here.'],
      player: { ...makeState().player, x: 10, y: 12 },
    });
    maybeNarrate(state3);
    await new Promise(r => setTimeout(r, 0));

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Actions since last narration (3 turns)');
    expect(prompt).toContain('Turn 1:');
    expect(prompt).toContain('Turn 2:');
    expect(prompt).toContain('Turn 3:');
    expect(prompt).toContain('Net changes since last narration');
  });

  it('turn log is cleared after narration fires', async () => {
    // First turn: narration fires
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['You find nothing.'] }));
    // Wait for async narrate() to complete (even with 'none' provider it's async)
    await new Promise(r => setTimeout(r, 0));
    expect(getLoggedPrompt()).toContain('Player action:');

    // Reset spy for next narration
    logSpy.mockClear();

    // Second turn: should be a fresh single-turn prompt, not accumulating
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 2, messages: ['You find nothing again.'] }));
    await new Promise(r => setTimeout(r, 0));

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Player action:');
    expect(prompt).not.toContain('Actions since last narration');
  });

  it('preserves enriched action with prompt Q&A chain', async () => {
    gameState.actionContext = {
      action: { action: 'eat', item: 'h', itemName: 'an uncursed food ration' },
      prompts: [
        { type: 'yn', query: 'There is a food ration here; eat it?', answer: 'y' },
      ],
    };
    const state = makeState({ messages: ['This food ration is delicious!'] });
    maybeNarrate(state);
    await new Promise(r => setTimeout(r, 0));

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('eat item h (an uncursed food ration)');
    expect(prompt).toContain('Prompted:');
    expect(prompt).toContain('eat it?');
    expect(prompt).toContain('answered yes');
  });

  it('resetNarrationState clears turn log', async () => {
    // Accumulate a turn without narration
    gameState.actionContext = { action: { action: 'move', direction: 'north' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: [] }));

    // Reset
    resetNarrationState();
    llmState.entries = [];

    // Next narration should be fresh (single-turn), not include the old log
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 2, messages: ['You find nothing.'] }));
    await new Promise(r => setTimeout(r, 0));

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Player action:');
    expect(prompt).not.toContain('Actions since last narration');
    expect(prompt).not.toContain('Turn 1:');
  });
});

describe('buildMiniMap', () => {
  it('renders full map with entity overlays and legend', () => {
    const state = makeState({
      map: [
        '-----',
        '|...|',
        '|.@.|',
        '|...|',
        '-----',
      ],
      player: { ...makeState().player, x: 2, y: 2 },
      entities: [
        { type: 'monster', x: 3, y: 3, name: 'goblin', char: 'G', color: 0, pet: false },
        { type: 'monster', x: 1, y: 1, name: 'kitten', char: 'f', color: 0, pet: true },
        { type: 'item', x: 3, y: 1, name: 'dagger', category: 'weapon', char: ')', color: 0 },
      ],
    });
    const result = buildMiniMap(state);

    // Contains the map with entities overlaid
    expect(result).toContain('@');
    expect(result).toContain('G');
    expect(result).toContain('f');
    expect(result).toContain(')');

    // Contains coordinates
    expect(result).toContain('(2,2)');

    // Legend with entity names and positions
    expect(result).toContain('G=goblin at (3,3)');
    expect(result).toContain('f=kitten (pet) at (1,1)');
    expect(result).toContain(')=dagger at (3,1)');
  });

  it('skips blank rows', () => {
    const state = makeState({
      map: ['     ', '  @  ', '     '],
      player: { ...makeState().player, x: 2, y: 1 },
      entities: [],
    });
    const result = buildMiniMap(state);
    // Only the row with @ should appear
    expect(result).toContain('@');
    expect(result.split('\n').filter(l => l.includes('     ')).length).toBe(0);
  });

  it('returns empty string for empty map', () => {
    const state = makeState({ map: [], entities: [] });
    expect(buildMiniMap(state)).toBe('');
  });

  it('uses (x,y) coordinate system', () => {
    const state = makeState({
      map: ['...', '...', '...'],
      player: { ...makeState().player, x: 1, y: 0 },
      entities: [
        { type: 'monster', x: 2, y: 1, name: 'rat', char: 'r', color: 0, pet: false },
      ],
    });
    const result = buildMiniMap(state);
    // Player at x=1,y=0 — should be (1,0) not (0,1)
    expect(result).toContain('(1,0)');
    expect(result).toContain('r=rat at (2,1)');
  });

  it('door legend uses the actual map character, not a hardcoded +', () => {
    // Open door shows as - on the map (horizontal wall orientation)
    // Closed door shows as + on the map
    const state = makeState({
      map: [
        '---+---',
        '|.@..|',
        '----.--',
      ],
      player: { ...makeState().player, x: 2, y: 1 },
      entities: [],
      terrain: {
        playerTerrain: 'ROOM',
        playerRoom: { roomNo: 1, width: 5, height: 1, lit: true, tileCount: 5 },
        playerLit: true,
        nearbyRooms: [],
        features: [],
        exits: [
          { x: 3, y: 0, direction: 'north wall, adjacent', type: 'closed door', color: 7 },
          { x: 3, y: 2, direction: 'south wall, adjacent', type: 'open door', color: 7 },
        ],
        visibleFloorTiles: 5,
        darkLOSTiles: 0,
      },
    });
    const result = buildMiniMap(state);

    // The map should show the original characters, not override them
    // Closed door at (3,0) is + on the map
    expect(result).toContain('+=closed door at (3,0)');
    // Open door at (3,2) is - on the map (horizontal open door)
    expect(result).toContain('-=open door at (3,2)');
    // The map itself should NOT have the open door changed to +
    expect(result).not.toContain('+=open door');
  });

  it('door legend falls back to canonical glyph when player stands on a door (regression)', () => {
    // When the player is standing on a door tile, gameMap[exit.y][exit.x]
    // returns '@' (the player glyph), not the door glyph. The legend
    // would otherwise claim `@ = open door` and collide with the player
    // entry. Substitute the canonical door character instead.
    const state = makeState({
      map: [
        '------',
        '|...@|', // player @ is standing on the open door at (4,1)
        '------',
      ],
      player: { ...makeState().player, x: 4, y: 1 },
      entities: [],
      terrain: {
        playerTerrain: 'DOOR',
        playerRoom: null,
        playerLit: true,
        nearbyRooms: [],
        features: [],
        exits: [
          { x: 4, y: 1, direction: 'east wall, here', type: 'open door', color: 7 },
        ],
        visibleFloorTiles: 4,
        darkLOSTiles: 0,
      },
    });
    const result = buildMiniMap(state);

    // The legend must NOT say `@ = open door` — that would collide with
    // the player entry and confuse the LLM.
    expect(result).not.toContain('@=open door');
    // It should fall back to the canonical open-door glyph '/'.
    expect(result).toContain('/=open door at (4,1)');
  });

  it('door legend falls back to canonical glyph for closed door when player stands on it', () => {
    const state = makeState({
      map: [
        '------',
        '|...@|',
        '------',
      ],
      player: { ...makeState().player, x: 4, y: 1 },
      entities: [],
      terrain: {
        playerTerrain: 'DOOR',
        playerRoom: null,
        playerLit: true,
        nearbyRooms: [],
        features: [],
        exits: [
          { x: 4, y: 1, direction: 'east wall, here', type: 'closed door', color: 7 },
        ],
        visibleFloorTiles: 4,
        darkLOSTiles: 0,
      },
    });
    const result = buildMiniMap(state);

    expect(result).not.toContain('@=closed door');
    expect(result).toContain('+=closed door at (4,1)');
  });

  it('LLM map matches the in-game map characters', () => {
    // The buildMiniMap output should use the same characters as state.map
    // (entities overlay, but terrain stays as-is)
    const mapRows = [
      '------',
      '|.@.+|',
      '------',
    ];
    const state = makeState({
      map: mapRows,
      player: { ...makeState().player, x: 2, y: 1 },
      entities: [],
    });
    const result = buildMiniMap(state);

    // Each non-blank map row should appear in the output with @ overlaid
    // The + in the map (closed door) should remain as +, not be altered
    const outputLines = result.split('\n');
    const mapLine = outputLines.find(l => l.startsWith('|') && l.includes('@'));
    expect(mapLine).toBe('|.@.+|');
  });
});


describe('formatNarrationHistoryEntry', () => {
  it('renders the compact header with turn, dlvl, HP, and action', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 142,
      text: 'The bitter liquid sears your throat.',
      timestamp: 0,
      header: { dlvl: 3, hp: 12, maxHp: 18, conditions: [], properties: [], action: 'quaff potion d' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toContain('[T142, dlvl 3, HP 12/18]');
    expect(out).toContain('quaff potion d');
    expect(out).toContain('> The bitter liquid sears your throat.');
  });

  it('includes active conditions in the header when present', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 99,
      text: 'You soar through the cavern.',
      timestamp: 0,
      header: { dlvl: 4, hp: 20, maxHp: 20, conditions: ['flying', 'hungry'], properties: [], action: 'move east' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toContain('[T99, dlvl 4, HP 20/20, flying, hungry]');
    expect(out).toContain('move east');
  });

  it('omits action when empty, keeping only the bracketed header', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 50,
      text: 'A silent moment passes.',
      timestamp: 0,
      header: { dlvl: 2, hp: 10, maxHp: 12, conditions: [], properties: [], action: '' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toMatch(/^\[T50, dlvl 2, HP 10\/12\]\n> A silent moment passes\.$/);
  });

  it('falls back to just [T<turn>] for legacy entries without a header', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 17,
      text: 'Before the header system existed.',
      timestamp: 0,
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toMatch(/^\[T17\]\n> Before the header system existed\.$/);
  });

  it('quotes each line of a multi-line narration with "> " prefix', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 200,
      text: 'Line one.\nLine two.',
      timestamp: 0,
      header: { dlvl: 5, hp: 15, maxHp: 20, conditions: [], properties: [], action: 'search' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toContain('> Line one.');
    expect(out).toContain('> Line two.');
  });
});

describe('formatNarrationHistory', () => {
  function mkEntry(turn: number, text = `narration ${turn}`): LLMEntry {
    return {
      kind: 'narration',
      turn,
      text,
      timestamp: 0,
      header: { dlvl: 1, hp: 10, maxHp: 10, conditions: [], properties: [], action: '' },
    };
  }

  it('returns empty string when there are no narrations', () => {
    expect(formatNarrationHistory([])).toBe('');
  });

  it('ignores analysis entries', () => {
    const entries: LLMEntry[] = [
      { kind: 'analysis', turn: 5, text: 'advice', timestamp: 0 },
    ];
    expect(formatNarrationHistory(entries)).toBe('');
  });

  it('includes all narrations when under the limit, oldest first', () => {
    const entries = [mkEntry(1), mkEntry(2), mkEntry(3)];
    const out = formatNarrationHistory(entries);
    const idx1 = out.indexOf('narration 1');
    const idx2 = out.indexOf('narration 2');
    const idx3 = out.indexOf('narration 3');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it(`truncates to the most recent ${NARRATION_HISTORY_LIMIT} entries`, () => {
    const n = NARRATION_HISTORY_LIMIT + 10;
    const entries = Array.from({ length: n }, (_, i) => mkEntry(i + 1));
    const out = formatNarrationHistory(entries);
    // The oldest 10 should be dropped; the newest 50 should remain.
    expect(out).not.toContain('narration 1\n');
    expect(out).not.toContain('narration 10\n');
    expect(out).toContain(`narration 11`);
    expect(out).toContain(`narration ${n}`);
  });

  it('respects an explicit limit argument', () => {
    const entries = [mkEntry(1), mkEntry(2), mkEntry(3), mkEntry(4)];
    const out = formatNarrationHistory(entries, 2);
    expect(out).not.toContain('narration 1');
    expect(out).not.toContain('narration 2');
    expect(out).toContain('narration 3');
    expect(out).toContain('narration 4');
  });

  it('prepends a header introducing the section to the LLM', () => {
    const out = formatNarrationHistory([mkEntry(1)]);
    expect(out).toContain('RECENT NARRATION HISTORY');
    expect(out.toLowerCase()).toContain('do not repeat');
  });
});

describe('buildCurrentStateBlock', () => {
  it('includes character identity, stats, and hunger', () => {
    const state = makeState({
      name_title: 'Test the Valkyrie',
      alignment: 'Lawful',
      gender: 'Female',
      race: 'Human',
      role: 'Valkyrie',
      player: {
        ...makeState().player,
        hp: 14, max_hp: 22, pw: 3, max_pw: 5, ac: 8,
        xp: 47, xp_level: 3, gold: 120, score: 543,
        hunger: 'Hungry',
      },
    });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Character: Test the Valkyrie (Lawful Female Human Valkyrie)');
    expect(out).toContain('HP: 14/22, Power: 3/5, AC 8, XP level 3 (47 xp), Gold: 120, Score: 543');
    expect(out).toContain('Hunger: Hungry');
  });

  it('includes ability scores (Str, Dex, Con, Int, Wis, Cha)', () => {
    const state = makeState({
      player: {
        ...makeState().player,
        str: 18, dex: 13, con: 12, int: 9, wis: 10, cha: 6,
      },
    });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Abilities: Str 18, Dex 13, Con 12, Int 9, Wis 10, Cha 6');
  });

  it('lists active conditions when present, "none" when absent', () => {
    const withConds = buildCurrentStateBlock(makeState({ conditions: ['flying', 'hungry'] }));
    expect(withConds).toContain('Active effects: flying, hungry');
    const withoutConds = buildCurrentStateBlock(makeState({ conditions: [] }));
    expect(withoutConds).toContain('Active effects: none');
  });

  it('lists equipped items', () => {
    const state = makeState({
      inventory: [
        { letter: 'a', text: 'a +1 long sword (weapon in hand)', oclass: 'weapon', worn: true },
        { letter: 'b', text: 'an uncursed ring mail (being worn)', oclass: 'armor', worn: true },
        { letter: 'c', text: '10 uncursed food rations', oclass: 'food', worn: false },
      ],
    });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Equipped:');
    expect(out).toContain('- a +1 long sword (weapon in hand)');
    expect(out).toContain('- an uncursed ring mail (being worn)');
    // Food rations are not worn, not in Equipped block
    const equippedSectionOnly = out.slice(out.indexOf('Equipped:'), out.indexOf('Pets:'));
    expect(equippedSectionOnly).not.toContain('food rations');
  });

  it('shows "(nothing)" when no items are equipped', () => {
    const state = makeState({ inventory: [] });
    expect(buildCurrentStateBlock(state)).toContain('Equipped: (nothing)');
  });

  it('separates pets from non-pet monsters', () => {
    const state = makeState({
      player: { ...makeState().player, x: 10, y: 10 },
      entities: [
        { type: 'monster', name: 'grid bug', x: 13, y: 10, char: 'x', color: 0, pet: false },
        { type: 'monster', name: 'saddled pony', x: 11, y: 10, char: 'u', color: 0, pet: true },
      ],
    });
    const out = buildCurrentStateBlock(state);
    const petsSection = out.slice(out.indexOf('Pets:'), out.indexOf('Nearby creatures:'));
    const monstersSection = out.slice(out.indexOf('Nearby creatures:'), out.indexOf('Items on the floor'));
    expect(petsSection).toContain('saddled pony');
    expect(petsSection).not.toContain('grid bug');
    expect(monstersSection).toContain('grid bug');
    expect(monstersSection).not.toContain('saddled pony');
  });

  it('shows "(none visible)" placeholders for empty categories', () => {
    const state = makeState({ entities: [] });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Pets: (none visible)');
    expect(out).toContain('Nearby creatures: (none visible)');
    expect(out).toContain('Items on the floor nearby: (none visible)');
  });

  it('keeps terrain features out of the floor-items block', () => {
    const state = makeState({
      terrain: makeTerrain({
        features: [{ name: 'fountain', x: 12, y: 10, inSight: true }],
      }),
      entities: [
        { type: 'item', name: 'fountain', category: 'fountain', x: 12, y: 10, char: '{', color: 0 },
        { type: 'item', name: 'gold', category: 'gold', x: 13, y: 10, char: '$', color: 0 },
      ],
    });
    const out = buildCurrentStateBlock(state);
    const itemsSection = out.slice(out.indexOf('Items on the floor nearby:'), out.indexOf('Inventory:'));
    expect(itemsSection).toContain('gold');
    expect(itemsSection).not.toContain('fountain');
  });

  it('includes the full inventory (not just equipped)', () => {
    const state = makeState({
      inventory: [
        { letter: 'a', text: 'a +1 long sword (weapon in hand)', oclass: 'weapon', worn: true },
        { letter: 'b', text: 'a scroll of identify', oclass: 'scroll', worn: false },
        { letter: 'c', text: 'a wand of striking', oclass: 'wand', worn: false },
      ],
    });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Inventory:');
    expect(out).toContain('a) a +1 long sword');
    expect(out).toContain('b) a scroll of identify');
    expect(out).toContain('c) a wand of striking');
  });

  it('shows "(empty)" when inventory is empty', () => {
    expect(buildCurrentStateBlock(makeState({ inventory: [] }))).toContain('Inventory: (empty)');
  });

  it('includes dungeon level in the location line', () => {
    expect(buildCurrentStateBlock(makeState({ dlvl: 7 }))).toContain('Dungeon level 7');
  });

  it('excludes the player-as-entity from Nearby creatures', () => {
    // wasm-connection adds the player as a monster-type entity with
    // name "you" at the player's tile. buildCurrentStateBlock must not
    // list it as a nearby creature.
    const state = makeState({
      player: { ...makeState().player, x: 10, y: 10 },
      entities: [
        { type: 'monster', name: 'you', x: 10, y: 10, char: '@', color: 0, pet: false },
      ],
    });
    const out = buildCurrentStateBlock(state);
    expect(out).toContain('Nearby creatures: (none visible)');
  });
});

describe('buildThisTurnBlock', () => {
  it('includes filtered game messages', () => {
    const state = makeState({
      messages: ['You hit the grid bug!', 'The grid bug is killed!'],
    });
    const out = buildThisTurnBlock(state, [], []);
    expect(out).toContain('Game messages:');
    expect(out).toContain('You hit the grid bug!');
    expect(out).toContain('The grid bug is killed!');
  });

  it('says "(no messages)" when there are none', () => {
    expect(buildThisTurnBlock(makeState({ messages: [] }), [], []))
      .toContain('(no messages)');
  });

  it('includes a single-turn action/diff log', () => {
    const state = makeState();
    const log = [
      { turn: 42, action: 'move east', messages: [], diff: ['Turn advanced', 'Moved east'] },
    ];
    const out = buildThisTurnBlock(state, log, []);
    expect(out).toContain('move east');
    expect(out).toContain('Turn advanced');
    expect(out).toContain('Moved east');
  });

  it('appends aggregated diff when the log covers multiple turns', () => {
    const state = makeState();
    const log = [
      { turn: 42, action: 'move east', messages: [], diff: ['Moved east'] },
      { turn: 43, action: 'move south', messages: [], diff: ['Moved south'] },
    ];
    const aggregated = ['HP: 18 → 15', 'Grid bug moved closer (now 2 tiles east)'];
    const out = buildThisTurnBlock(state, log, aggregated);
    expect(out).toContain('Net changes since last narration:');
    expect(out).toContain('HP: 18 → 15');
    expect(out).toContain('Grid bug moved closer');
  });

  it('drops stale visibility removals from the aggregate section after a reappearance', () => {
    const state = makeState({
      entities: [
        { type: 'monster', name: 'kitten', x: 11, y: 10, char: 'f', color: 0, pet: true },
      ],
    });
    const log = [
      { turn: 11, action: 'move west', messages: [], diff: ['Your pet kitten is no longer visible'] },
      { turn: 12, action: 'move east', messages: [], diff: ['Your pet kitten reappeared (adjacent east)'] },
    ];
    const aggregated = [
      '13 turns advanced',
      'Your pet kitten reappeared (adjacent east)',
      'Your pet kitten is no longer visible',
    ];
    const out = buildThisTurnBlock(state, log, aggregated);
    const netSection = out.slice(out.indexOf('Net changes since last narration:'));

    expect(netSection).toContain('Your pet kitten reappeared (adjacent east)');
    expect(netSection).not.toContain('Your pet kitten is no longer visible');
  });

  it('omits the Net changes section for single-turn logs', () => {
    const state = makeState();
    const log = [{ turn: 42, action: 'search', messages: [], diff: ['Turn advanced'] }];
    const out = buildThisTurnBlock(state, log, ['something'] /* irrelevant for single-turn */);
    expect(out).not.toContain('Net changes since last narration');
  });
});

describe('narration entry header population', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    llmState.provider = 'none';
    llmState.setPreset('standard');
    llmState.entries = [];
    llmState.isGenerating = false;
    llmState.currentNarration = '';
    gameState.introText = [];
    gameState.messageHistory = [];
    gameState.lastAction = null;
    gameState.actionContext = null;
    resetNarrationState();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('new narration entries carry a header with game-moment context', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({
      turn: 42,
      dlvl: 3,
      player: { ...makeState().player, hp: 12, max_hp: 18, dlvl: 3 },
      conditions: ['hungry', 'flying'],
      messages: ['You find nothing.'],
    }));

    expect(llmState.entries.length).toBe(1);
    const entry = llmState.entries[0];
    expect(entry.kind).toBe('narration');
    expect(entry.header).toBeDefined();
    expect(entry.header!.dlvl).toBe(3);
    expect(entry.header!.hp).toBe(12);
    expect(entry.header!.maxHp).toBe(18);
    expect(entry.header!.conditions).toEqual(['hungry', 'flying']);
    expect(entry.header!.action).toBe('search');
  });

  it('subsequent narrations append new entries with distinct headers', async () => {
    gameState.actionContext = { action: { action: 'move', direction: 'east' }, prompts: [] };
    await narrate(makeState({
      turn: 10,
      player: { ...makeState().player, hp: 16, max_hp: 18 },
      messages: ['You walk east.'],
    }));

    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({
      turn: 11,
      player: { ...makeState().player, hp: 16, max_hp: 18 },
      messages: ['You find a trap!'],
    }));

    expect(llmState.entries.length).toBe(2);
    expect(llmState.entries[0].header!.action).toBe('move east');
    expect(llmState.entries[1].header!.action).toBe('search');
  });

  it('the header survives into the next narration\'s prompt via formatNarrationHistory', async () => {
    gameState.actionContext = { action: { action: 'quaff', item: 'd', itemName: 'potion of healing' }, prompts: [] };
    await narrate(makeState({
      turn: 50,
      dlvl: 2,
      player: { ...makeState().player, hp: 8, max_hp: 20, dlvl: 2 },
      conditions: ['hungry'],
      messages: ['You drink the potion.'],
    }));

    // Second narration — its prompt should include the first as history
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({
      turn: 51,
      messages: ['You find a passageway.'],
    }));

    const promptCall = logSpy.mock.calls.find(c => c[0] === '[NARRATION PROMPT]' && String(c[1]).includes('T50'));
    expect(promptCall, 'second narration prompt should contain the first entry in history').toBeDefined();
    const prompt = String(promptCall![1]);
    expect(prompt).toContain('[T50, dlvl 2, HP 8/20, hungry]');
    expect(prompt).toContain('quaff item d (potion of healing)');
  });
});

describe('buildSystemInstructions', () => {
  it('game-start variant asks for an opening narration', () => {
    const out = buildSystemInstructions(true);
    expect(out.toLowerCase()).toContain('opening narration');
    expect(out).toContain('Amulet of Yendor');
  });

  it('regular variant asks for concise narration and continuity', () => {
    const out = buildSystemInstructions(false);
    expect(out).toContain('1-2 sentences');
    expect(out).toContain('continuous, unfolding story');
    expect(out).toContain('CURRENT STATE');
    expect(out).toContain('RECENT NARRATION HISTORY');
  });

  it('forbids markdown headers and titles in BOTH variants (regression)', () => {
    // The narration is rendered as continuous prose; markdown headers
    // appear literally as "# Some Title" text mid-story. The system
    // prompt must explicitly forbid them.
    for (const isGameStart of [true, false]) {
      const out = buildSystemInstructions(isGameStart);
      expect(out).toContain('markdown headers');
      expect(out.toLowerCase()).toContain('do not use markdown headers');
      expect(out.toLowerCase()).toContain('do not prefix narrations with a title');
    }
  });
});

describe('friendlyConditionName / friendlyConditionList', () => {
  it('translates common 3.6.7/3.7 shared bits to readable phrases', () => {
    expect(friendlyConditionName('fly')).toBe('flying');
    expect(friendlyConditionName('lev')).toBe('levitating');
    expect(friendlyConditionName('conf')).toBe('confused');
    expect(friendlyConditionName('stun')).toBe('stunned');
    expect(friendlyConditionName('hallu')).toBe('hallucinating');
    expect(friendlyConditionName('foodpois')).toBe('food poisoned');
    expect(friendlyConditionName('strngl')).toBe('strangling');
    expect(friendlyConditionName('termill')).toBe('terminally ill');
    expect(friendlyConditionName('stone')).toBe('turning to stone');
    expect(friendlyConditionName('slime')).toBe('turning into slime');
  });

  it('translates 3.7-only additions to readable phrases', () => {
    expect(friendlyConditionName('grab')).toBe('being grabbed');
    expect(friendlyConditionName('held')).toBe('held');
    expect(friendlyConditionName('inlava')).toBe('in lava');
    expect(friendlyConditionName('parlyz')).toBe('paralyzed');
    expect(friendlyConditionName('unconsc')).toBe('unconscious');
    expect(friendlyConditionName('woundedl')).toBe('with wounded legs');
    expect(friendlyConditionName('icy')).toBe('on icy footing');
    expect(friendlyConditionName('slippery')).toBe('on slippery footing');
    expect(friendlyConditionName('trapped')).toBe('trapped');
  });

  it('passes unknown condition names through unchanged (forward compat)', () => {
    // If a future NetHack release adds a new condition that this table
    // doesn't know about, the raw bit name should still surface rather
    // than silently disappearing.
    expect(friendlyConditionName('newfutureflag')).toBe('newfutureflag');
  });

  it('friendlyConditionList maps an array in order and preserves empty input', () => {
    expect(friendlyConditionList([])).toEqual([]);
    expect(friendlyConditionList(['fly', 'foodpois', 'hallu'])).toEqual([
      'flying', 'food poisoned', 'hallucinating',
    ]);
  });
});

describe('buildCurrentStateBlock — Active effects', () => {
  it('shows friendly names in the Active effects line (regression: flying showed as "none")', () => {
    // Repro of the user bug: wearing an amulet of flying sets the FLY
    // condition bit, but the state block used to render it as either
    // the raw "fly" string or — more recently, under 3.7 where the
    // API's bitmask table was wrong — silently drop it and show
    // "Active effects: none". Now we expect the friendly form.
    const out = buildCurrentStateBlock(makeState({ conditions: ['fly'] }));
    expect(out).toContain('Active effects: flying');
    expect(out).not.toContain('Active effects: fly\n');
    expect(out).not.toContain('Active effects: none');
  });

  it('joins multiple conditions with commas, all in friendly form', () => {
    const out = buildCurrentStateBlock(makeState({
      conditions: ['fly', 'conf', 'foodpois'],
    }));
    expect(out).toContain('Active effects: flying, confused, food poisoned');
  });

  it('still reports "none" when there are no conditions', () => {
    expect(buildCurrentStateBlock(makeState({ conditions: [] })))
      .toContain('Active effects: none');
  });
});

describe('computeDiff — condition changes use friendly names', () => {
  it('emits "Now flying" when the fly bit appears', () => {
    const prev = captureSnapshot(makeState({ turn: 1, conditions: [] }));
    const next = makeState({ turn: 2, conditions: ['fly'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Now flying');
    expect(diff).not.toContain('Now fly');
  });

  it('emits "No longer levitating" when the lev bit disappears', () => {
    const prev = captureSnapshot(makeState({ turn: 1, conditions: ['lev'] }));
    const next = makeState({ turn: 2, conditions: [] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('No longer levitating');
    expect(diff).not.toContain('No longer lev');
  });

  it('emits multiple condition changes in parallel, each in friendly form', () => {
    const prev = captureSnapshot(makeState({ turn: 1, conditions: ['hallu', 'stun'] }));
    const next = makeState({ turn: 2, conditions: ['conf', 'stun'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Now confused');
    expect(diff).toContain('No longer hallucinating');
    expect(diff).not.toContain('stunned'); // unchanged — no diff line
  });
});

describe('formatNarrationHistoryEntry — condition header friendly names', () => {
  it('renders header conditions in friendly form', () => {
    const out = formatNarrationHistoryEntry({
      kind: 'narration',
      turn: 99,
      text: 'You soar through the cavern.',
      timestamp: 0,
      header: { dlvl: 4, hp: 20, maxHp: 20, conditions: ['fly', 'foodpois'], properties: [], action: 'move east' },
    });
    expect(out).toContain('[T99, dlvl 4, HP 20/20, flying, food poisoned]');
    expect(out).not.toContain('fly,');
    expect(out).not.toContain('foodpois');
  });
});

describe('maybeNarrate — serialization queue', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  // Helper: wait for all pending microtasks to settle. setTimeout(0) is
  // a macrotask, so by the time it fires all microtask continuations
  // from prior `await` expressions have already run — i.e., the whole
  // narration loop has drained.
  async function drain() {
    // Drain twice: one tick to let narrate() resolve, a second tick to
    // let any pendingCoalesce-triggered second narrate() resolve too.
    // Three is plenty for any bounded coalescing scenario.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
  }

  beforeEach(() => {
    llmState.provider = 'none'; // synchronous "[debug: LLM call skipped]"
    llmState.setPreset('standard');
    llmState.entries = [];
    llmState.isGenerating = false;
    llmState.currentNarration = '';
    gameState.introText = [];
    gameState.messageHistory = [];
    gameState.lastAction = null;
    gameState.actionContext = null;
    resetNarrationState();
    resetNarrationQueue();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Ensure any in-flight narration from the test finishes before the
    // next test starts, so state doesn't leak between tests.
    await drain();
    logSpy.mockRestore();
  });

  it('queue starts empty', () => {
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
  });

  it('fires narration immediately when queue is empty', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['You find a trap!'] }));

    // At this exact sync point: runNarrationLoop has run its prefix,
    // set inFlight=true, cleared turnLog, and is awaiting narrate().
    expect(getNarrationQueueState().inFlight).toBe(true);
    expect(getNarrationQueueState().pending).toBe(false);

    await drain();

    // After drain: loop fully done.
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
    expect(llmState.entries.length).toBe(1);
    expect(llmState.entries[0].turn).toBe(1);
  });

  it('coalesces multiple rapid turns while one is in flight', async () => {
    // Fire 3 narrations synchronously. Only the first should start
    // immediately; the other two coalesce into a single pending slot.
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['Event 1.'] }));
    maybeNarrate(makeState({ turn: 2, messages: ['Event 2.'] }));
    maybeNarrate(makeState({ turn: 3, messages: ['Event 3.'] }));

    // At this sync point, the first call's runNarrationLoop is awaiting
    // its narrate(). The 2nd and 3rd maybeNarrate calls coalesced.
    expect(getNarrationQueueState()).toEqual({ inFlight: true, pending: true });

    await drain();

    // Loop fully drained. We expect exactly 2 LLM calls total: the
    // immediate one for turn 1, and one coalesced call covering
    // turns 2 and 3 (narrated against the latest state, which is turn 3).
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
    expect(llmState.entries.length).toBe(2);
    // First entry describes turn 1.
    expect(llmState.entries[0].turn).toBe(1);
    // Second entry describes turn 3 (the latest state at drain time).
    expect(llmState.entries[1].turn).toBe(3);
  });

  it('does not drop turnLog data when narration is coalesced (regression)', async () => {
    // Before the queue, turnLog was cleared in maybeNarrate before the
    // narrate() guard check — so when the guard dropped the call, the
    // turn's events were lost forever. The queue version preserves
    // everything: the coalesced narration's prompt must contain the
    // events from ALL skipped turns.
    gameState.actionContext = { action: { action: 'move', direction: 'east' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['First notable event.'] }));
    gameState.actionContext = { action: { action: 'move', direction: 'south' }, prompts: [] };
    maybeNarrate(makeState({ turn: 2, messages: ['Second notable event.'] }));
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 3, messages: ['Third notable event.'] }));

    await drain();

    // Find the coalesced narration prompt — the second [NARRATION PROMPT]
    // log call. Its THIS TURN block should mention events from turn 2
    // and turn 3 (the ones that coalesced during turn 1's in-flight call).
    const promptCalls = logSpy.mock.calls.filter(c => c[0] === '[NARRATION PROMPT]');
    expect(promptCalls.length).toBeGreaterThanOrEqual(2);
    const secondPrompt = String(promptCalls[1][1]);
    expect(secondPrompt).toContain('Second notable event.');
    expect(secondPrompt).toContain('Third notable event.');
  });

  it('lastNarrationSnapshot only advances when a narration actually starts', async () => {
    // The aggregate diff on a coalesced narration should cover every
    // change from the last ACTUALLY-narrated state to the latest state,
    // not only changes since an attempted-but-dropped snapshot update.
    // This is the "corrupted baseline" bug.
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };

    // Turn 1: player at HP 18/20, narration fires immediately.
    maybeNarrate(makeState({
      turn: 1,
      player: { ...makeState().player, hp: 18, max_hp: 20 },
      messages: ['You enter a room.'],
    }));

    // Turns 2 and 3: player takes damage while first narration is in flight.
    // These coalesce into a single pending narration.
    maybeNarrate(makeState({
      turn: 2,
      player: { ...makeState().player, hp: 14, max_hp: 20 },
      messages: ['Ouch!'],
    }));
    maybeNarrate(makeState({
      turn: 3,
      player: { ...makeState().player, hp: 10, max_hp: 20 },
      messages: ['Ouch again!'],
    }));

    await drain();

    // The coalesced second narration should see an aggregate diff
    // spanning turns 1 → 3 (HP 18 → 10 = lost 8 HP). If lastNarrationSnapshot
    // had been corrupted by the dropped maybeNarrate calls, the aggregate
    // diff would instead show only the last single-turn delta.
    const promptCalls = logSpy.mock.calls.filter(c => c[0] === '[NARRATION PROMPT]');
    const secondPrompt = String(promptCalls[1][1]);
    // The turn log for the coalesced call has 2 entries (turns 2 and 3),
    // so "Net changes since last narration" should appear and report the
    // full 8 HP drop.
    expect(secondPrompt).toContain('Net changes since last narration');
    expect(secondPrompt).toMatch(/Lost 8 HP/);
  });

  it('clears pendingCoalesce at the start of each drain iteration', async () => {
    // Regression guard: the do-while must reset pendingCoalesce at the
    // top of each iteration, otherwise a single coalesce would spin
    // forever.
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['One.'] }));
    maybeNarrate(makeState({ turn: 2, messages: ['Two.'] }));
    maybeNarrate(makeState({ turn: 3, messages: ['Three.'] }));
    maybeNarrate(makeState({ turn: 4, messages: ['Four.'] }));

    await drain();

    // Queue fully drained — must not still be spinning.
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
    // Exactly 2 narrations: the immediate one for turn 1 and one
    // coalesced narration covering turns 2-4.
    expect(llmState.entries.length).toBe(2);
  });

  it('turnLog is empty after the loop fully drains', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['One.'] }));
    maybeNarrate(makeState({ turn: 2, messages: ['Two.'] }));
    maybeNarrate(makeState({ turn: 3, messages: ['Three.'] }));

    await drain();

    // Check via a follow-up narration: if the log were non-empty, the
    // next narration's prompt would incorrectly include stale entries.
    gameState.actionContext = { action: { action: 'wait' }, prompts: [] };
    maybeNarrate(makeState({ turn: 4, messages: ['Four.'] }));
    await drain();

    const promptCalls = logSpy.mock.calls.filter(c => c[0] === '[NARRATION PROMPT]');
    const lastPrompt = String(promptCalls[promptCalls.length - 1][1]);
    // The most recent prompt should describe turn 4 only, not be
    // polluted with references to turns 1-3.
    expect(lastPrompt).toContain('Four.');
    expect(lastPrompt).not.toContain('One.');
    expect(lastPrompt).not.toContain('Two.');
    expect(lastPrompt).not.toContain('Three.');
  });

  it('returns early on game_over without advancing the queue', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({
      turn: 1,
      game_over: true,
      messages: ['You die...'],
    }));

    // Nothing should be enqueued, turnLog stays empty, no narration.
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
    expect(llmState.entries.length).toBe(0);
  });

  it('resetNarrationState clears queue state so tests are independent', () => {
    // Put the queue into a dirty state.
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    maybeNarrate(makeState({ turn: 1, messages: ['One.'] }));
    maybeNarrate(makeState({ turn: 2, messages: ['Two.'] }));
    expect(getNarrationQueueState()).toEqual({ inFlight: true, pending: true });

    // Reset should wipe flags (note: won't cancel an actually in-flight
    // async operation, but there's no real async in provider='none' mode).
    resetNarrationState();
    expect(getNarrationQueueState()).toEqual({ inFlight: false, pending: false });
  });
});

describe('narration persistence (save/load)', () => {
  const slotId = 'test-persist-slot';

  beforeEach(() => {
    llmState.provider = 'none';
    llmState.entries = [];
    llmState.isGenerating = false;
    llmState.currentNarration = '';
    gameState.introText = [];
    gameState.lastAction = null;
    gameState.actionContext = null;
    resetNarrationState();
    resetNarrationQueue();
    clearNarrationStateForSlot(slotId);
  });

  afterEach(() => {
    clearNarrationStateForSlot(slotId);
  });

  it('round-trips entries (with headers) and turn log through save/load', async () => {
    // Generate a real narration via the queue so entries + headers get
    // populated the way they would in production.
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({
      turn: 42,
      dlvl: 2,
      player: { ...makeState().player, hp: 14, max_hp: 20, dlvl: 2 },
      conditions: ['hungry'],
      messages: ['You find nothing.'],
    }));
    expect(llmState.entries.length).toBe(1);

    saveNarrationStateForSlot(slotId);

    // Simulate a fresh-app reload: wipe in-memory state completely.
    llmState.entries = [];
    resetNarrationState();

    const ok = loadNarrationStateForSlot(slotId);
    expect(ok).toBe(true);
    expect(llmState.entries.length).toBe(1);

    const entry = llmState.entries[0];
    expect(entry.kind).toBe('narration');
    expect(entry.turn).toBe(42);
    // Header survived the round-trip verbatim.
    expect(entry.header).toBeDefined();
    expect(entry.header!.dlvl).toBe(2);
    expect(entry.header!.hp).toBe(14);
    expect(entry.header!.maxHp).toBe(20);
    expect(entry.header!.conditions).toEqual(['hungry']);
    expect(entry.header!.action).toBe('search');
  });

  it('loads legacy entries that have no header field (forward compat)', () => {
    // Simulate a v3 payload written by a future code path that didn't
    // attach a header (or by old persisted data before headers existed).
    const legacyPayload = {
      version: 3,
      lastNarrationSnapshot: null,
      turnLog: [],
      entries: [
        { kind: 'narration', turn: 7, text: 'Legacy narration.', timestamp: 1234 },
      ],
    };
    localStorage.setItem(`nethack-narration-state-${slotId}`, JSON.stringify(legacyPayload));

    const ok = loadNarrationStateForSlot(slotId);
    expect(ok).toBe(true);
    expect(llmState.entries.length).toBe(1);
    expect(llmState.entries[0].header).toBeUndefined();

    // formatNarrationHistoryEntry should fall back to the bare [T7] header.
    const rendered = formatNarrationHistoryEntry(llmState.entries[0]);
    expect(rendered).toContain('[T7]');
    expect(rendered).toContain('Legacy narration.');
  });

  it('rejects v1 payloads (from the old session-mode schema)', () => {
    // Simulate a stale v1 payload left behind by an older build that
    // still used session mode.
    const v1Payload = {
      version: 1,
      sessionMessages: [{ role: 'user', content: 'old session data' }],
      lastSent: null,
      lastNarrationSnapshot: null,
      turnLog: [],
      entries: [
        { kind: 'narration', turn: 1, text: 'Old narration.', timestamp: 1 },
      ],
    };
    localStorage.setItem(`nethack-narration-state-${slotId}`, JSON.stringify(v1Payload));

    const ok = loadNarrationStateForSlot(slotId);
    expect(ok).toBe(false);
    expect(llmState.entries.length).toBe(0);
  });

  it('clearNarrationStateForSlot removes the persisted payload', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({ turn: 1, messages: ['Saving.'] }));
    saveNarrationStateForSlot(slotId);

    // Confirm it's actually in storage.
    expect(localStorage.getItem(`nethack-narration-state-${slotId}`)).not.toBeNull();

    clearNarrationStateForSlot(slotId);
    expect(localStorage.getItem(`nethack-narration-state-${slotId}`)).toBeNull();

    // Attempting to load afterwards is a no-op.
    llmState.entries = [];
    expect(loadNarrationStateForSlot(slotId)).toBe(false);
    expect(llmState.entries.length).toBe(0);
  });

  it('does not persist session-mode fields (schema cleanup guard)', async () => {
    gameState.actionContext = { action: { action: 'search' }, prompts: [] };
    await narrate(makeState({ turn: 1, messages: ['Saving.'] }));
    saveNarrationStateForSlot(slotId);

    const raw = localStorage.getItem(`nethack-narration-state-${slotId}`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(3);
    expect(parsed.sessionMessages).toBeUndefined();
    expect(parsed.lastSent).toBeUndefined();
    // Required v2 fields are present.
    expect(parsed.entries).toBeDefined();
    expect(parsed.turnLog).toBeDefined();
    // lastNarrationSnapshot may be null if no diff has been captured yet,
    // but the key should exist in the payload.
    expect('lastNarrationSnapshot' in parsed).toBe(true);
  });
});

// ── Properties integration ──

describe('friendlyPropertyName', () => {
  it('translates known property names', () => {
    expect(friendlyPropertyName('FIRE_RES')).toBe('fire resistance');
    expect(friendlyPropertyName('SEE_INVIS')).toBe('see invisible');
    expect(friendlyPropertyName('TELEPAT')).toBe('telepathy');
    expect(friendlyPropertyName('STEALTH')).toBe('stealth');
    expect(friendlyPropertyName('WWALKING')).toBe('water walking');
    expect(friendlyPropertyName('HALF_SPDAM')).toBe('half spell damage');
    expect(friendlyPropertyName('LIFESAVED')).toBe('life saving');
  });

  it('lowercases unknown property names with underscores replaced', () => {
    expect(friendlyPropertyName('SOME_FUTURE_PROP')).toBe('some future prop');
  });
});

describe('friendlyPropertyList', () => {
  it('filters out condition-overlap properties', () => {
    const result = friendlyPropertyList([
      'FIRE_RES', 'STUNNED', 'CONFUSION', 'STEALTH', 'FLYING', 'LEVITATION',
    ]);
    expect(result).toEqual(['fire resistance', 'stealth', 'flying', 'levitating']);
    expect(result).not.toContain('stunned');
    expect(result).not.toContain('confused');
  });

  it('returns empty array when all properties overlap with conditions', () => {
    expect(friendlyPropertyList(['STUNNED', 'BLINDED', 'HALLUC'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(friendlyPropertyList([])).toEqual([]);
  });
});

describe('properties in buildCurrentStateBlock', () => {
  it('includes Active properties line with property names', () => {
    const out = buildCurrentStateBlock(makeState({
      properties: ['FIRE_RES', 'SEE_INVIS', 'STEALTH'],
    }));
    expect(out).toContain('Active properties: fire resistance, see invisible, stealth');
  });

  it('shows "none" when no non-overlap properties are active', () => {
    const out = buildCurrentStateBlock(makeState({ properties: [] }));
    expect(out).toContain('Active properties: none');
  });

  it('excludes condition-overlap properties from the properties line', () => {
    const out = buildCurrentStateBlock(makeState({
      properties: ['FIRE_RES', 'STUNNED', 'FLYING'],
    }));
    expect(out).toContain('fire resistance');
    expect(out).toContain('flying');
    expect(out).not.toMatch(/Active properties:.*stunned/i);
  });
});

describe('properties in computeDiff', () => {
  it('reports gained properties', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: [] }));
    const next = makeState({ turn: 2, properties: ['FIRE_RES'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Gained fire resistance');
  });

  it('reports lost properties', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: ['STEALTH'] }));
    const next = makeState({ turn: 2, properties: [] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Lost stealth');
  });

  it('reports both gained and lost in the same diff', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: ['COLD_RES', 'TELEPAT'] }));
    const next = makeState({ turn: 2, properties: ['COLD_RES', 'FIRE_RES'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Gained fire resistance');
    expect(diff).toContain('Lost telepathy');
    expect(diff).not.toContain('cold resistance'); // unchanged
  });

  it('skips condition-overlap properties in diff', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: [] }));
    const next = makeState({ turn: 2, properties: ['STUNNED', 'FIRE_RES'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Gained fire resistance');
    expect(diff.filter(l => l.includes('stunned') || l.includes('Stunned'))).toHaveLength(0);
  });

  it('emits no property lines when properties unchanged', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: ['FIRE_RES'] }));
    const next = makeState({ turn: 2, properties: ['FIRE_RES'] });
    const diff = computeDiff(prev, next);
    expect(diff.filter(l => l.includes('fire resistance'))).toHaveLength(0);
  });
});

describe('properties in captureSnapshot', () => {
  it('captures properties array', () => {
    const snap = captureSnapshot(makeState({ properties: ['FIRE_RES', 'SEE_INVIS'] }));
    expect(snap.properties).toEqual(['FIRE_RES', 'SEE_INVIS']);
  });

  it('captures empty properties', () => {
    const snap = captureSnapshot(makeState({ properties: [] }));
    expect(snap.properties).toEqual([]);
  });
});

describe('properties in narration history header', () => {
  it('includes properties in formatted header', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 50,
      text: 'You feel resistant.',
      timestamp: 0,
      header: { dlvl: 3, hp: 20, maxHp: 20, conditions: [], properties: ['FIRE_RES', 'STEALTH'], action: 'quaff potion' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toContain('fire resistance');
    expect(out).toContain('stealth');
  });

  it('handles legacy entries without properties field', () => {
    const entry: LLMEntry = {
      kind: 'narration',
      turn: 10,
      text: 'A legacy narration.',
      timestamp: 0,
      header: { dlvl: 1, hp: 10, maxHp: 10, conditions: [], properties: [], action: '' },
    };
    const out = formatNarrationHistoryEntry(entry);
    expect(out).toContain('[T10');
  });
});

describe('warnedMonsters integration', () => {
  it('friendlyPropertyName resolves WARN_OF_MON with specific targets', () => {
    expect(friendlyPropertyName('WARN_OF_MON', ['orcs'])).toBe('warned of orcs');
    expect(friendlyPropertyName('WARN_OF_MON', ['orcs', 'elves'])).toBe('warned of orcs, elves');
  });

  it('friendlyPropertyName uses fallback when warnedMonsters is empty', () => {
    expect(friendlyPropertyName('WARN_OF_MON', [])).toBe('warned of a monster type');
    expect(friendlyPropertyName('WARN_OF_MON')).toBe('warned of a monster type');
  });

  it('friendlyPropertyList passes warnedMonsters through', () => {
    const result = friendlyPropertyList(['FIRE_RES', 'WARN_OF_MON'], ['orcs']);
    expect(result).toContain('fire resistance');
    expect(result).toContain('warned of orcs');
  });

  it('buildCurrentStateBlock shows warned monster types', () => {
    const out = buildCurrentStateBlock(makeState({
      properties: ['WARN_OF_MON', 'STEALTH'],
      warnedMonsters: ['orcs', 'elves'],
    }));
    expect(out).toContain('warned of orcs, elves');
    expect(out).toContain('stealth');
  });

  it('computeDiff shows specific warned types when gaining WARN_OF_MON', () => {
    const prev = captureSnapshot(makeState({ turn: 1, properties: [] }));
    const next = makeState({ turn: 2, properties: ['WARN_OF_MON'], warnedMonsters: ['orcs'] });
    const diff = computeDiff(prev, next);
    expect(diff).toContain('Gained warned of orcs');
  });

  it('captureSnapshot captures warnedMonsters', () => {
    const snap = captureSnapshot(makeState({ warnedMonsters: ['demons', 'giants'] }));
    expect(snap.warnedMonsters).toEqual(['demons', 'giants']);
  });
});

describe('analyze', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    llmState.provider = 'none';
    llmState.entries = [];
    llmState.isAnalyzing = false;
    llmState.analysisResult = '';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function getLoggedPrompt(): string {
    const call = logSpy.mock.calls.find(c => c[0] === '[ANALYSIS PROMPT]');
    return call ? String(call[1]) : '';
  }

  it('produces an analysis entry with the debug provider', async () => {
    const state = makeState({ messages: ['You see a kobold.'] });
    await analyze(state);

    expect(llmState.entries).toHaveLength(1);
    expect(llmState.entries[0].kind).toBe('analysis');
    expect(llmState.entries[0].text).toBe('[debug: LLM call skipped]');
    expect(llmState.isAnalyzing).toBe(false);
  });

  it('logs the analysis prompt', async () => {
    const state = makeState({ messages: ['You see a kobold.'] });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('NetHack assistant');
    expect(prompt).toContain('Player the Stripling');
  });

  it('includes role, race, gender in the prompt', async () => {
    const state = makeState({
      role: 'Wizard',
      race: 'Elf',
      gender: 'Male',
    });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Wizard');
    expect(prompt).toContain('Elf');
    expect(prompt).toContain('Male');
  });

  it('includes properties in the prompt when present', async () => {
    const state = makeState({
      properties: ['telepathy', 'stealth'],
    });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('Properties:');
    expect(prompt).toContain('telepathy');
  });

  it('skips when already analyzing', async () => {
    llmState.isAnalyzing = true;
    const state = makeState();
    await analyze(state);

    expect(llmState.entries).toHaveLength(0);
  });

  it('skips when not configured', async () => {
    llmState.provider = 'anthropic';
    // No API key set — isConfigured should be false
    const origKey = llmState.apiKey;
    llmState.apiKey = '';
    const state = makeState();
    await analyze(state);

    expect(llmState.entries).toHaveLength(0);
    llmState.apiKey = origKey;
  });

  it('resets isAnalyzing after completion', async () => {
    const state = makeState();
    await analyze(state);

    expect(llmState.isAnalyzing).toBe(false);
    expect(llmState.analysisResult).not.toBe('');
  });

  it('streams chunks into analysisResult', async () => {
    const state = makeState();
    await analyze(state);

    // With 'none' provider, the full placeholder is set
    expect(llmState.analysisResult).toBe('[debug: LLM call skipped]');
  });

  it('includes prompt line when awaiting input with a non-empty prompt', async () => {
    const state = makeState({ awaiting_input: true, prompt: 'What do you want to eat?' });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).toContain('The game is currently prompting them: "What do you want to eat?"');
  });

  it('omits prompt line when awaiting input with an empty prompt', async () => {
    const state = makeState({ awaiting_input: true, prompt: '' });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).not.toContain('currently prompting');
  });

  it('omits prompt line when not awaiting input', async () => {
    const state = makeState({ awaiting_input: false, prompt: '' });
    await analyze(state);

    const prompt = getLoggedPrompt();
    expect(prompt).not.toContain('currently prompting');
  });
});
