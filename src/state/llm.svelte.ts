import type { LLMEntry } from '../types/llm';
import type { NarrationTriggerConfig, TriggerSet } from '../types/narration-triggers';
import { PRESETS, ALL_TRIGGERS, detectPreset, defaultTriggerConfig, DEFAULT_IGNORED_PATTERNS } from '../types/narration-triggers';
import type { PresetName } from '../types/narration-triggers';
import { DEFAULT_NARRATION_HUE, DEFAULT_ANALYSIS_HUE, DEFAULT_NARRATION_INTENSITY, DEFAULT_ANALYSIS_INTENSITY } from '../utils/color-derive';

function loadApiKeys(): Record<string, string> {
  const saved = localStorage.getItem('llm_api_keys');
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  // Migrate from old single-key storage
  const oldKey = localStorage.getItem('llm_api_key');
  const oldProvider = localStorage.getItem('llm_provider') || 'anthropic';
  if (oldKey) {
    return { [oldProvider]: oldKey };
  }
  return {};
}

function loadTriggerConfig(): NarrationTriggerConfig {
  // Try new format first
  const saved = localStorage.getItem('narration_triggers');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as NarrationTriggerConfig;
      // Ensure all trigger keys exist (forward-compat if we add new triggers)
      for (const t of ALL_TRIGGERS) {
        if (typeof parsed.triggers[t] !== 'boolean') {
          parsed.triggers[t] = false;
        }
      }
      parsed.activePreset = detectPreset(parsed.triggers);
      if (!Array.isArray(parsed.ignoredMessagePatterns)) {
        parsed.ignoredMessagePatterns = [...DEFAULT_IGNORED_PATTERNS];
      }
      return parsed;
    } catch { /* fall through */ }
  }

  // Migrate from old narrationMode
  const defaults = defaultTriggerConfig();
  const oldMode = localStorage.getItem('narration_mode');
  switch (oldMode) {
    case 'on': return { ...defaults, triggers: { ...PRESETS.standard }, activePreset: 'standard' };
    case 'partial': return { ...defaults, triggers: { ...PRESETS.minimal }, activePreset: 'minimal' };
    case 'off': return { ...defaults, triggers: { ...PRESETS.off }, activePreset: 'off' };
    default: return defaults;
  }
}

class LLMStore {
  provider = $state(localStorage.getItem('llm_provider') || 'anthropic');
  narratorModel = $state(localStorage.getItem('llm_narrator_model') || 'claude-haiku-4-5-20251001');
  analysisModel = $state(localStorage.getItem('llm_analysis_model') || 'claude-sonnet-4-20250514');
  apiKeys = $state<Record<string, string>>(loadApiKeys());
  triggerConfig = $state<NarrationTriggerConfig>(loadTriggerConfig());
  narrationHue = $state(Number(localStorage.getItem('narration_hue')) || DEFAULT_NARRATION_HUE);
  analysisHue = $state(Number(localStorage.getItem('analysis_hue')) || DEFAULT_ANALYSIS_HUE);
  narrationIntensity = $state(Number(localStorage.getItem('narration_intensity') ?? '') || DEFAULT_NARRATION_INTENSITY);
  analysisIntensity = $state(Number(localStorage.getItem('analysis_intensity') ?? '') || DEFAULT_ANALYSIS_INTENSITY);

  isGenerating = $state(false);
  currentNarration = $state('');
  entries = $state<LLMEntry[]>([]);

  isAnalyzing = $state(false);
  analysisResult = $state('');

  get apiKey(): string {
    return this.apiKeys[this.provider] || '';
  }

  set apiKey(value: string) {
    this.apiKeys[this.provider] = value;
  }

  get isConfigured(): boolean {
    return this.provider === 'none' || this.apiKey.length > 0;
  }

  /** True if any trigger is enabled. */
  get isNarrationEnabled(): boolean {
    return ALL_TRIGGERS.some(t => this.triggerConfig.triggers[t]);
  }

  /** True if every trigger is enabled. */
  get allTriggersEnabled(): boolean {
    return ALL_TRIGGERS.every(t => this.triggerConfig.triggers[t]);
  }

  setPreset(name: PresetName) {
    this.triggerConfig = {
      ...this.triggerConfig,
      triggers: { ...PRESETS[name] },
      activePreset: name,
    };
  }

  toggleTrigger(trigger: keyof TriggerSet) {
    const updated = { ...this.triggerConfig.triggers };
    updated[trigger] = !updated[trigger];
    this.triggerConfig = {
      ...this.triggerConfig,
      triggers: updated,
      activePreset: detectPreset(updated),
    };
  }

  addIgnoredPattern(pattern: string) {
    const trimmed = pattern.trim();
    if (!trimmed || this.triggerConfig.ignoredMessagePatterns.includes(trimmed)) return;
    this.triggerConfig = {
      ...this.triggerConfig,
      ignoredMessagePatterns: [...this.triggerConfig.ignoredMessagePatterns, trimmed],
    };
  }

  removeIgnoredPattern(pattern: string) {
    this.triggerConfig = {
      ...this.triggerConfig,
      ignoredMessagePatterns: this.triggerConfig.ignoredMessagePatterns.filter(p => p !== pattern),
    };
  }

  updateIgnoredPattern(index: number, newPattern: string) {
    const updated = [...this.triggerConfig.ignoredMessagePatterns];
    updated[index] = newPattern;
    this.triggerConfig = {
      ...this.triggerConfig,
      ignoredMessagePatterns: updated,
    };
  }

  saveSettings() {
    localStorage.setItem('llm_provider', this.provider);
    localStorage.setItem('llm_narrator_model', this.narratorModel);
    localStorage.setItem('llm_analysis_model', this.analysisModel);
    localStorage.setItem('llm_api_keys', JSON.stringify(this.apiKeys));
    localStorage.setItem('narration_triggers', JSON.stringify(this.triggerConfig));
    localStorage.setItem('narration_hue', String(this.narrationHue));
    localStorage.setItem('analysis_hue', String(this.analysisHue));
    localStorage.setItem('narration_intensity', String(this.narrationIntensity));
    localStorage.setItem('analysis_intensity', String(this.analysisIntensity));
    // Clean up old key from previous narration mode system
    localStorage.removeItem('narration_mode');
    // Legacy session mode toggle was removed — clean up any stale key
    // from earlier versions so it doesn't sit orphaned in localStorage.
    localStorage.removeItem('llm_session_memory');
  }

  clearNarration() {
    this.entries = [];
    this.currentNarration = '';
    this.analysisResult = '';
  }
}

export const llmState = new LLMStore();
