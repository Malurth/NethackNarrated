/** Individual narration trigger identifiers. */
export type NarrationTrigger =
  | 'gameMessages'
  | 'levelChange'
  | 'hpLoss'
  | 'statusCondition'
  | 'monsterAppeared'
  | 'visionExpansion'
  | 'inventoryChange';

export const ALL_TRIGGERS: NarrationTrigger[] = [
  'gameMessages',
  'levelChange',
  'hpLoss',
  'statusCondition',
  'monsterAppeared',
  'visionExpansion',
  'inventoryChange',
];

export const TRIGGER_LABELS: Record<NarrationTrigger, string> = {
  gameMessages: 'Game Messages',
  levelChange: 'Level Change',
  hpLoss: 'Significant HP Loss',
  statusCondition: 'Status Conditions',
  monsterAppeared: 'New Monsters in View',
  visionExpansion: 'Vision Expansion',
  inventoryChange: 'Inventory Changes',
};

export type PresetName = 'verbose' | 'standard' | 'minimal' | 'off';

export const PRESET_LABELS: Record<PresetName, string> = {
  verbose: 'Verbose',
  standard: 'Standard',
  minimal: 'Minimal',
  off: 'Off',
};

export const ALL_PRESETS: PresetName[] = ['verbose', 'standard', 'minimal', 'off'];

export type TriggerSet = Record<NarrationTrigger, boolean>;

export interface NarrationTriggerConfig {
  triggers: TriggerSet;
  activePreset: PresetName | 'custom';
  ignoredMessagePatterns: string[];
}

function allOn(): TriggerSet {
  return Object.fromEntries(ALL_TRIGGERS.map(t => [t, true])) as TriggerSet;
}

function allOff(): TriggerSet {
  return Object.fromEntries(ALL_TRIGGERS.map(t => [t, false])) as TriggerSet;
}

export const PRESETS: Record<PresetName, TriggerSet> = {
  verbose: allOn(),
  standard: {
    gameMessages: true,
    levelChange: true,
    hpLoss: true,
    statusCondition: true,
    monsterAppeared: false,
    visionExpansion: false,
    inventoryChange: false,
  },
  minimal: {
    gameMessages: true,
    levelChange: true,
    hpLoss: true,
    statusCondition: false,
    monsterAppeared: false,
    visionExpansion: false,
    inventoryChange: false,
  },
  off: allOff(),
};

/** Check if a trigger set matches a known preset, returning the name or 'custom'. */
export function detectPreset(triggers: TriggerSet): PresetName | 'custom' {
  for (const preset of ALL_PRESETS) {
    const expected = PRESETS[preset];
    if (ALL_TRIGGERS.every(t => triggers[t] === expected[t])) return preset;
  }
  return 'custom';
}

export const DEFAULT_IGNORED_PATTERNS: string[] = [
  'You swap places with *',
];

/** Convert a wildcard pattern (using * as glob) to a RegExp. */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`, 'i');
}

/** Test whether a message matches any of the ignored patterns. */
export function matchesIgnoredPattern(message: string, patterns: string[]): boolean {
  return patterns.some(p => patternToRegex(p).test(message));
}

/** Create a default config (Standard preset). */
export function defaultTriggerConfig(): NarrationTriggerConfig {
  return {
    triggers: { ...PRESETS.standard },
    activePreset: 'standard',
    ignoredMessagePatterns: [...DEFAULT_IGNORED_PATTERNS],
  };
}
