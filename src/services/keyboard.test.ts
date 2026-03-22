import { describe, it, expect } from 'vitest';
import { KEY_TO_ACTION, INVENTORY_VERB_ACTIONS, clickToMoveAction } from './keyboard';

describe('KEY_TO_ACTION', () => {
  describe('vi-key movement', () => {
    it('maps hjkl to cardinal directions', () => {
      expect(KEY_TO_ACTION['h']).toBe('move_west');
      expect(KEY_TO_ACTION['j']).toBe('move_south');
      expect(KEY_TO_ACTION['k']).toBe('move_north');
      expect(KEY_TO_ACTION['l']).toBe('move_east');
    });

    it('maps yubn to diagonal directions', () => {
      expect(KEY_TO_ACTION['y']).toBe('move_northwest');
      expect(KEY_TO_ACTION['u']).toBe('move_northeast');
      expect(KEY_TO_ACTION['b']).toBe('move_southwest');
      expect(KEY_TO_ACTION['n']).toBe('move_southeast');
    });
  });

  describe('arrow key movement', () => {
    it('maps arrow keys to cardinal directions', () => {
      expect(KEY_TO_ACTION['ArrowUp']).toBe('move_north');
      expect(KEY_TO_ACTION['ArrowDown']).toBe('move_south');
      expect(KEY_TO_ACTION['ArrowRight']).toBe('move_east');
      expect(KEY_TO_ACTION['ArrowLeft']).toBe('move_west');
    });
  });

  describe('basic actions', () => {
    it('maps . to wait', () => {
      expect(KEY_TO_ACTION['.']).toBe('wait');
    });

    it('maps , to pickup', () => {
      expect(KEY_TO_ACTION[',']).toBe('pickup');
    });

    it('maps > and < to stairs', () => {
      expect(KEY_TO_ACTION['>']).toBe('go_down');
      expect(KEY_TO_ACTION['<']).toBe('go_up');
    });

    it('maps space to more', () => {
      expect(KEY_TO_ACTION[' ']).toBe('more');
    });

    it('maps Escape to esc', () => {
      expect(KEY_TO_ACTION['Escape']).toBe('esc');
    });
  });

  describe('inventory verbs', () => {
    it('maps inventory verb keys', () => {
      expect(KEY_TO_ACTION['e']).toBe('eat');
      expect(KEY_TO_ACTION['q']).toBe('drink');
      expect(KEY_TO_ACTION['r']).toBe('read');
      expect(KEY_TO_ACTION['z']).toBe('zap');
      expect(KEY_TO_ACTION['W']).toBe('wear');
      expect(KEY_TO_ACTION['w']).toBe('wield');
      expect(KEY_TO_ACTION['P']).toBe('putOn');
      expect(KEY_TO_ACTION['T']).toBe('takeOff');
      expect(KEY_TO_ACTION['d']).toBe('drop');
      expect(KEY_TO_ACTION['t']).toBe('throw');
    });
  });
});

describe('INVENTORY_VERB_ACTIONS', () => {
  it('contains all 11 inventory verb actions', () => {
    expect(INVENTORY_VERB_ACTIONS.size).toBe(11);
  });

  it('includes all expected verbs', () => {
    const expected = [
      'drink', 'read', 'zap', 'wear', 'wield',
      'putOn', 'takeOff', 'eat', 'drop', 'throw', 'quiver',
    ];
    for (const verb of expected) {
      expect(INVENTORY_VERB_ACTIONS.has(verb)).toBe(true);
    }
  });

  it('does not include non-verb actions', () => {
    expect(INVENTORY_VERB_ACTIONS.has('move_north')).toBe(false);
    expect(INVENTORY_VERB_ACTIONS.has('wait')).toBe(false);
    expect(INVENTORY_VERB_ACTIONS.has('search')).toBe(false);
  });
});

describe('clickToMoveAction', () => {
  const px = 10;
  const py = 10;

  it('returns null when clicking on the player', () => {
    expect(clickToMoveAction(px, py, px, py)).toBeNull();
  });

  describe('cardinal directions', () => {
    it('returns move_north when clicking above', () => {
      expect(clickToMoveAction(px, py, px, py - 1)).toBe('move_north');
      expect(clickToMoveAction(px, py, px, py - 5)).toBe('move_north');
    });

    it('returns move_south when clicking below', () => {
      expect(clickToMoveAction(px, py, px, py + 1)).toBe('move_south');
    });

    it('returns move_east when clicking right', () => {
      expect(clickToMoveAction(px, py, px + 1, py)).toBe('move_east');
    });

    it('returns move_west when clicking left', () => {
      expect(clickToMoveAction(px, py, px - 1, py)).toBe('move_west');
    });
  });

  describe('diagonal directions', () => {
    it('returns move_northeast when clicking upper-right', () => {
      expect(clickToMoveAction(px, py, px + 3, py - 2)).toBe('move_northeast');
    });

    it('returns move_northwest when clicking upper-left', () => {
      expect(clickToMoveAction(px, py, px - 1, py - 1)).toBe('move_northwest');
    });

    it('returns move_southeast when clicking lower-right', () => {
      expect(clickToMoveAction(px, py, px + 1, py + 1)).toBe('move_southeast');
    });

    it('returns move_southwest when clicking lower-left', () => {
      expect(clickToMoveAction(px, py, px - 1, py + 1)).toBe('move_southwest');
    });
  });

  it('normalizes large distances to single-step directions', () => {
    // Far away clicks still produce a single direction
    expect(clickToMoveAction(0, 0, 100, 50)).toBe('move_southeast');
    expect(clickToMoveAction(50, 50, 0, 0)).toBe('move_northwest');
  });
});
