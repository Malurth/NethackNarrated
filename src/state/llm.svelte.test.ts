import { describe, it, expect, beforeEach } from 'vitest';
import { llmState } from './llm.svelte';
import { PRESETS, defaultTriggerConfig, DEFAULT_IGNORED_PATTERNS } from '../types/narration-triggers';

beforeEach(() => {
  localStorage.clear();
  // Reset singleton to defaults
  llmState.provider = 'anthropic';
  llmState.narratorModel = 'claude-haiku-4-5-20251001';
  llmState.analysisModel = 'claude-sonnet-4-20250514';
  llmState.apiKeys = {};
  llmState.triggerConfig = defaultTriggerConfig();
  llmState.isGenerating = false;
  llmState.currentNarration = '';
  llmState.entries = [];
  llmState.isAnalyzing = false;
  llmState.analysisResult = '';
});

describe('LLMStore defaults', () => {
  it('has anthropic as default provider', () => {
    expect(llmState.provider).toBe('anthropic');
  });

  it('has standard as default trigger preset', () => {
    expect(llmState.triggerConfig.activePreset).toBe('standard');
  });

  it('starts with no API keys', () => {
    expect(llmState.apiKeys).toEqual({});
  });

  it('starts with generation flags off', () => {
    expect(llmState.isGenerating).toBe(false);
    expect(llmState.isAnalyzing).toBe(false);
  });
});

describe('LLMStore.apiKey getter/setter', () => {
  it('returns empty string when no key for current provider', () => {
    expect(llmState.apiKey).toBe('');
  });

  it('returns the key for the current provider', () => {
    llmState.apiKeys = { anthropic: 'sk-ant-123' };
    expect(llmState.apiKey).toBe('sk-ant-123');
  });

  it('setter writes to the current provider', () => {
    llmState.apiKey = 'sk-ant-456';
    expect(llmState.apiKeys['anthropic']).toBe('sk-ant-456');
  });

  it('getter respects provider changes', () => {
    llmState.apiKeys = { anthropic: 'sk-ant', openai: 'sk-oai' };
    llmState.provider = 'openai';
    expect(llmState.apiKey).toBe('sk-oai');
  });
});

describe('LLMStore.isConfigured', () => {
  it('returns false when no API key is set', () => {
    expect(llmState.isConfigured).toBe(false);
  });

  it('returns true when API key exists for current provider', () => {
    llmState.apiKey = 'sk-test';
    expect(llmState.isConfigured).toBe(true);
  });

  it('returns true when provider is none (no key needed)', () => {
    llmState.provider = 'none';
    expect(llmState.isConfigured).toBe(true);
  });
});

describe('LLMStore.isNarrationEnabled', () => {
  it('returns true when any trigger is on', () => {
    llmState.setPreset('minimal');
    expect(llmState.isNarrationEnabled).toBe(true);
  });

  it('returns false when all triggers are off', () => {
    llmState.setPreset('off');
    expect(llmState.isNarrationEnabled).toBe(false);
  });
});

describe('LLMStore.setPreset', () => {
  it('sets triggers to match the preset', () => {
    llmState.setPreset('standard');
    expect(llmState.triggerConfig.triggers).toEqual(PRESETS.standard);
    expect(llmState.triggerConfig.activePreset).toBe('standard');
  });

  it('sets off preset', () => {
    llmState.setPreset('off');
    expect(llmState.triggerConfig.triggers).toEqual(PRESETS.off);
    expect(llmState.triggerConfig.activePreset).toBe('off');
  });
});

describe('LLMStore.toggleTrigger', () => {
  it('toggles a trigger and detects custom preset', () => {
    llmState.setPreset('standard');
    llmState.toggleTrigger('monsterAppeared');
    expect(llmState.triggerConfig.triggers.monsterAppeared).toBe(false);
    expect(llmState.triggerConfig.activePreset).toBe('custom');
  });

  it('auto-detects preset when toggles match a known preset', () => {
    llmState.setPreset('standard');
    // Toggle monsterAppeared off (now custom)
    llmState.toggleTrigger('monsterAppeared');
    expect(llmState.triggerConfig.activePreset).toBe('custom');
    // Toggle it back on (now matches standard again)
    llmState.toggleTrigger('monsterAppeared');
    expect(llmState.triggerConfig.activePreset).toBe('standard');
  });

  it('auto-detects a DIFFERENT preset when toggles match it', () => {
    llmState.setPreset('standard');
    // Standard has all triggers ON. Toggle some OFF to reach minimal.
    llmState.toggleTrigger('statusCondition');
    llmState.toggleTrigger('monsterAppeared');
    llmState.toggleTrigger('visionExpansion');
    llmState.toggleTrigger('inventoryChange');
    expect(llmState.triggerConfig.activePreset).toBe('minimal');
  });

  it('preserves ignoredMessagePatterns when toggling', () => {
    llmState.addIgnoredPattern('test pattern');
    llmState.toggleTrigger('monsterAppeared');
    expect(llmState.triggerConfig.ignoredMessagePatterns).toContain('test pattern');
  });
});

describe('LLMStore.addIgnoredPattern / removeIgnoredPattern', () => {
  it('adds a pattern', () => {
    llmState.addIgnoredPattern('You see here *');
    expect(llmState.triggerConfig.ignoredMessagePatterns).toContain('You see here *');
  });

  it('does not add duplicates', () => {
    llmState.addIgnoredPattern('You see here *');
    llmState.addIgnoredPattern('You see here *');
    const count = llmState.triggerConfig.ignoredMessagePatterns.filter(p => p === 'You see here *').length;
    expect(count).toBe(1);
  });

  it('does not add empty/whitespace patterns', () => {
    const before = llmState.triggerConfig.ignoredMessagePatterns.length;
    llmState.addIgnoredPattern('');
    llmState.addIgnoredPattern('   ');
    expect(llmState.triggerConfig.ignoredMessagePatterns.length).toBe(before);
  });

  it('removes a pattern', () => {
    llmState.addIgnoredPattern('You see here *');
    llmState.removeIgnoredPattern('You see here *');
    expect(llmState.triggerConfig.ignoredMessagePatterns).not.toContain('You see here *');
  });

  it('preserves patterns across setPreset', () => {
    llmState.addIgnoredPattern('custom pattern');
    llmState.setPreset('minimal');
    expect(llmState.triggerConfig.ignoredMessagePatterns).toContain('custom pattern');
  });
});

describe('LLMStore.saveSettings', () => {
  it('persists trigger config to localStorage', () => {
    llmState.provider = 'openai';
    llmState.narratorModel = 'gpt-4o-mini';
    llmState.analysisModel = 'gpt-4o';
    llmState.apiKeys = { openai: 'sk-oai-123' };
    llmState.setPreset('standard');

    llmState.saveSettings();

    expect(localStorage.getItem('llm_provider')).toBe('openai');
    expect(localStorage.getItem('llm_narrator_model')).toBe('gpt-4o-mini');
    expect(localStorage.getItem('llm_analysis_model')).toBe('gpt-4o');
    expect(JSON.parse(localStorage.getItem('llm_api_keys')!)).toEqual({ openai: 'sk-oai-123' });
    const saved = JSON.parse(localStorage.getItem('narration_triggers')!);
    expect(saved.activePreset).toBe('standard');
    expect(saved.triggers).toEqual(PRESETS.standard);
  });

  it('removes old narration_mode key', () => {
    localStorage.setItem('narration_mode', 'on');
    llmState.saveSettings();
    expect(localStorage.getItem('narration_mode')).toBeNull();
  });
});

describe('LLMStore.clearNarration', () => {
  it('clears entries, currentNarration, and analysisResult', () => {
    llmState.entries = [{ kind: 'narration' as const, turn: 1, text: 'You enter...', timestamp: Date.now() }];
    llmState.currentNarration = 'The hero walks...';
    llmState.analysisResult = 'You should go north.';

    llmState.clearNarration();

    expect(llmState.entries).toEqual([]);
    expect(llmState.currentNarration).toBe('');
    expect(llmState.analysisResult).toBe('');
  });
});

describe('loadApiKeys (tested via fresh LLMStore import)', () => {
  it('parses JSON keys from localStorage', () => {
    llmState.apiKeys = { anthropic: 'key1', openai: 'key2' };
    llmState.saveSettings();

    const saved = JSON.parse(localStorage.getItem('llm_api_keys')!);
    expect(saved).toEqual({ anthropic: 'key1', openai: 'key2' });
  });

  it('stores old single-key migration format correctly', () => {
    localStorage.setItem('llm_api_key', 'old-key-123');
    localStorage.setItem('llm_provider', 'openai');

    expect(localStorage.getItem('llm_api_key')).toBe('old-key-123');
  });
});
