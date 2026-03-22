/** Parse BUC (blessed/uncursed/cursed) status from inventory text */
export function parseBUC(text: string): 'blessed' | 'uncursed' | 'cursed' | 'unknown' {
  if (/\bblessed\b/.test(text)) return 'blessed';
  if (/\bcursed\b/.test(text)) return 'cursed';
  if (/\buncursed\b/.test(text)) return 'uncursed';
  return 'unknown';
}

/** Get CSS color for BUC status */
export function bucColor(buc: string): string {
  switch (buc) {
    case 'blessed': return 'var(--buc-blessed)';
    case 'cursed': return 'var(--buc-cursed)';
    case 'uncursed': return 'var(--buc-uncursed)';
    default: return 'var(--text)';
  }
}

export interface ItemVerb {
  verb: string;
  label: string;
}

const ALL_VERBS: ItemVerb[] = [
  { verb: 'wield', label: 'Wield' },
  { verb: 'wear', label: 'Wear' },
  { verb: 'putOn', label: 'Put on' },
  { verb: 'takeOff', label: 'Take off' },
  { verb: 'drink', label: 'Quaff' },
  { verb: 'eat', label: 'Eat' },
  { verb: 'read', label: 'Read' },
  { verb: 'zap', label: 'Zap' },
  { verb: 'apply', label: 'Apply' },
  { verb: 'drop', label: 'Drop' },
  { verb: 'throw', label: 'Throw' },
];

/** Map NLE object class name to a UI category for icons and actions */
export function oclassToCategory(oclass: string): string {
  switch (oclass) {
    case 'weapon': return 'weapon';
    case 'armor': return 'armor';
    case 'ring': return 'ring';
    case 'amulet': return 'amulet';
    case 'tool': case 'ball': case 'chain': return 'tool';
    case 'food': return 'food';
    case 'potion': return 'potion';
    case 'scroll': return 'scroll';
    case 'spellbook': return 'spellbook';
    case 'wand': return 'wand';
    case 'coin': return 'gold';
    case 'gem': case 'rock': return 'gem';
    default: return 'other';
  }
}

// Equip/unequip pairs — when worn/wielded, the "on" verb swaps to the "off" verb
const EQUIP_PAIRS: Record<string, string> = {
  wear: 'takeOff',
  putOn: 'takeOff',
  wield: 'wield', // wield toggles itself (wield another = unwield current)
};

// Verbs that are ONLY valid for certain categories.
// If a verb isn't listed here, it's available to all categories.
const VERB_VALID_CATEGORIES: Record<string, Set<string>> = {
  wield: new Set(['weapon', 'tool']),
  wear: new Set(['armor']),
  putOn: new Set(['ring', 'amulet']),
  takeOff: new Set(['armor', 'ring', 'amulet']),
  drink: new Set(['potion']),
  read: new Set(['scroll', 'spellbook']),
  zap: new Set(['wand']),
  eat: new Set(['food']),
};

const CATEGORY_ACTIONS: Record<string, string[]> = {
  weapon:    ['wield', 'drop', 'throw'],
  armor:     ['wear', 'drop'],
  ring:      ['putOn', 'drop'],
  amulet:    ['putOn', 'drop'],
  wand:      ['zap', 'apply', 'drop'],
  potion:    ['drink', 'drop', 'throw'],
  scroll:    ['read', 'drop'],
  spellbook: ['read', 'drop'],
  food:      ['eat', 'drop', 'throw'],
  tool:      ['apply', 'drop'],
  gem:       ['throw', 'drop'],
  gold:      ['drop'],
  other:     ['apply', 'drop', 'throw'],
};

/** Get relevant action verbs for an item — shown when the item is expanded.
 *  Combines category-specific verbs with any other verbs valid for this
 *  category, swapping equip↔unequip based on worn status. */
export function primaryActions(category: string, worn = false): ItemVerb[] {
  const relevant = new Set<string>();

  // Category-specific verbs (with equip/unequip swap)
  for (const v of (CATEGORY_ACTIONS[category] ?? CATEGORY_ACTIONS.other)) {
    relevant.add(worn && EQUIP_PAIRS[v] ? EQUIP_PAIRS[v] : v);
  }

  // Any other verbs that are valid for this category
  for (const [verb, validCats] of Object.entries(VERB_VALID_CATEGORIES)) {
    if (validCats.has(category)) {
      relevant.add(worn && EQUIP_PAIRS[verb] ? EQUIP_PAIRS[verb] : verb);
    }
  }

  // Maintain stable order from ALL_VERBS
  return ALL_VERBS.filter(a => relevant.has(a.verb));
}

/** Get all remaining verbs not in primaryActions — hidden behind "More". */
export function secondaryActions(category: string, worn = false): ItemVerb[] {
  const primaryVerbs = new Set(primaryActions(category, worn).map(a => a.verb));
  return ALL_VERBS.filter(a => !primaryVerbs.has(a.verb));
}

/** Get an emoji symbol for item category display */
export function categorySymbol(category: string): string {
  switch (category) {
    case 'weapon': return '\u2694\uFE0F';
    case 'armor': return '\uD83D\uDEE1\uFE0F';
    case 'ring': return '\uD83D\uDC8D';
    case 'amulet': return '\uD83D\uDCFF';
    case 'wand': return '\u2728';
    case 'potion': return '\uD83E\uDDEA';
    case 'scroll': return '\uD83D\uDCDC';
    case 'spellbook': return '\uD83D\uDCD5';
    case 'food': return '\uD83C\uDF56';
    case 'tool': return '\uD83D\uDD27';
    case 'gem': return '\uD83D\uDC8E';
    case 'gold': return '\uD83D\uDCB0';
    default: return '\uD83D\uDCE6';
  }
}
