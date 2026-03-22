import { describe, it, expect } from 'vitest';
import {
  parseBUC,
  bucColor,
  oclassToCategory,
  primaryActions,
  secondaryActions,
  categorySymbol,
} from './item-categories';

describe('parseBUC', () => {
  it('detects blessed', () => {
    expect(parseBUC('a blessed +1 long sword')).toBe('blessed');
  });

  it('detects cursed', () => {
    expect(parseBUC('a cursed -1 ring mail')).toBe('cursed');
  });

  it('detects uncursed', () => {
    expect(parseBUC('an uncursed potion of healing')).toBe('uncursed');
  });

  it('returns unknown when no BUC status present', () => {
    expect(parseBUC('a potion of healing')).toBe('unknown');
    expect(parseBUC('')).toBe('unknown');
  });

  it('requires word boundaries (no partial matches)', () => {
    // "unblessed" should not match "blessed"
    // This is a theoretical edge case — NetHack doesn't use these words,
    // but it validates the regex uses \b
    expect(parseBUC('an accursedly long sword')).toBe('unknown');
  });

  it('returns first matching status (blessed before cursed)', () => {
    // Pathological input — blessed is checked first
    expect(parseBUC('blessed and cursed artifact')).toBe('blessed');
  });
});

describe('bucColor', () => {
  it('returns CSS var for each BUC status', () => {
    expect(bucColor('blessed')).toBe('var(--buc-blessed)');
    expect(bucColor('cursed')).toBe('var(--buc-cursed)');
    expect(bucColor('uncursed')).toBe('var(--buc-uncursed)');
  });

  it('returns default text color for unknown', () => {
    expect(bucColor('unknown')).toBe('var(--text)');
    expect(bucColor('')).toBe('var(--text)');
    expect(bucColor('something')).toBe('var(--text)');
  });
});

describe('oclassToCategory', () => {
  it('maps standard NLE object classes', () => {
    expect(oclassToCategory('weapon')).toBe('weapon');
    expect(oclassToCategory('armor')).toBe('armor');
    expect(oclassToCategory('ring')).toBe('ring');
    expect(oclassToCategory('amulet')).toBe('amulet');
    expect(oclassToCategory('food')).toBe('food');
    expect(oclassToCategory('potion')).toBe('potion');
    expect(oclassToCategory('scroll')).toBe('scroll');
    expect(oclassToCategory('spellbook')).toBe('spellbook');
    expect(oclassToCategory('wand')).toBe('wand');
  });

  it('maps tool-like classes to tool', () => {
    expect(oclassToCategory('tool')).toBe('tool');
    expect(oclassToCategory('ball')).toBe('tool');
    expect(oclassToCategory('chain')).toBe('tool');
  });

  it('maps coin to gold', () => {
    expect(oclassToCategory('coin')).toBe('gold');
  });

  it('maps gem and rock to gem', () => {
    expect(oclassToCategory('gem')).toBe('gem');
    expect(oclassToCategory('rock')).toBe('gem');
  });

  it('returns other for unknown classes', () => {
    expect(oclassToCategory('mystery')).toBe('other');
    expect(oclassToCategory('')).toBe('other');
  });
});

describe('primaryActions', () => {
  it('includes category-specific verbs for weapons', () => {
    const verbs = primaryActions('weapon').map(v => v.verb);
    expect(verbs).toContain('wield');
    expect(verbs).toContain('drop');
    expect(verbs).toContain('throw');
  });

  it('includes category-specific and valid verbs for armor', () => {
    const verbs = primaryActions('armor').map(v => v.verb);
    expect(verbs).toContain('wear');
    expect(verbs).toContain('drop');
    expect(verbs).toContain('takeOff');
  });

  it('includes zap/apply/drop for wands', () => {
    const verbs = primaryActions('wand').map(v => v.verb);
    expect(verbs).toContain('zap');
    expect(verbs).toContain('apply');
    expect(verbs).toContain('drop');
  });

  it('includes drink/drop/throw for potions', () => {
    const verbs = primaryActions('potion').map(v => v.verb);
    expect(verbs).toContain('drink');
    expect(verbs).toContain('drop');
    expect(verbs).toContain('throw');
  });

  it('swaps wear→takeOff when worn', () => {
    const verbs = primaryActions('armor', true).map(v => v.verb);
    expect(verbs).toContain('takeOff');
    expect(verbs).not.toContain('wear');
  });

  it('swaps putOn→takeOff when worn (ring)', () => {
    const verbs = primaryActions('ring', true).map(v => v.verb);
    expect(verbs).toContain('takeOff');
    expect(verbs).not.toContain('putOn');
  });

  it('returns labels alongside verbs', () => {
    const actions = primaryActions('potion');
    const drink = actions.find(a => a.verb === 'drink');
    expect(drink).toEqual({ verb: 'drink', label: 'Quaff' });
  });

  it('falls back to other category for unknown items', () => {
    const verbs = primaryActions('unknown_thing').map(v => v.verb);
    expect(verbs).toContain('apply');
    expect(verbs).toContain('drop');
    expect(verbs).toContain('throw');
  });

  it('does not include irrelevant verbs', () => {
    const weaponVerbs = primaryActions('weapon').map(v => v.verb);
    expect(weaponVerbs).not.toContain('read');
    expect(weaponVerbs).not.toContain('zap');
    expect(weaponVerbs).not.toContain('drink');

    const potionVerbs = primaryActions('potion').map(v => v.verb);
    expect(potionVerbs).not.toContain('wield');
    expect(potionVerbs).not.toContain('wear');
    expect(potionVerbs).not.toContain('zap');
  });
});

describe('secondaryActions', () => {
  it('returns all verbs NOT in primary', () => {
    const primary = new Set(primaryActions('weapon').map(v => v.verb));
    const secondary = secondaryActions('weapon').map(v => v.verb);

    // No overlap
    for (const v of secondary) {
      expect(primary.has(v)).toBe(false);
    }
    // Secondary should contain the irrelevant verbs
    expect(secondary).toContain('read');
    expect(secondary).toContain('zap');
    expect(secondary).toContain('drink');
  });

  it('primary + secondary covers all verbs', () => {
    for (const cat of ['weapon', 'armor', 'potion', 'scroll', 'wand', 'ring', 'food', 'tool']) {
      const all = [
        ...primaryActions(cat).map(v => v.verb),
        ...secondaryActions(cat).map(v => v.verb),
      ];
      expect(all.length, `${cat} should cover all 11 verbs`).toBe(11);
    }
  });

  it('adjusts for worn status', () => {
    const secondary = secondaryActions('armor', true).map(v => v.verb);
    // When worn, primary has takeOff, so wear moves to secondary
    expect(secondary).toContain('wear');
    expect(secondary).not.toContain('takeOff');
  });
});

describe('categorySymbol', () => {
  it('returns a non-empty string for all known categories', () => {
    const categories = [
      'weapon', 'armor', 'ring', 'amulet', 'wand', 'potion',
      'scroll', 'spellbook', 'food', 'tool', 'gem', 'gold',
    ];
    for (const cat of categories) {
      expect(categorySymbol(cat).length).toBeGreaterThan(0);
    }
  });

  it('returns a fallback symbol for unknown category', () => {
    expect(categorySymbol('mystery')).toBeDefined();
    expect(categorySymbol('mystery').length).toBeGreaterThan(0);
  });

  it('returns distinct symbols for each category', () => {
    const symbols = new Set([
      'weapon', 'armor', 'ring', 'amulet', 'wand', 'potion',
      'scroll', 'spellbook', 'food', 'tool', 'gem', 'gold',
    ].map(categorySymbol));
    expect(symbols.size).toBe(12);
  });
});
