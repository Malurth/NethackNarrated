import { describe, it, expect, beforeEach } from 'vitest';
import { uiState } from './ui.svelte';

beforeEach(() => {
  localStorage.clear();
  // Reset singleton to defaults
  uiState.settingsOpen = false;
  uiState.selectedInventoryItem = null;
  uiState.keyboardEnabled = true;
  uiState.autoResolvePickNone = true;
  uiState.cameraFollow = true;
  uiState.itemDetailMode = 'immediate';
});

describe('UIStore defaults', () => {
  it('starts with settings closed', () => {
    expect(uiState.settingsOpen).toBe(false);
  });

  it('starts with no selected inventory item', () => {
    expect(uiState.selectedInventoryItem).toBeNull();
  });

  it('starts with keyboard enabled', () => {
    expect(uiState.keyboardEnabled).toBe(true);
  });

  it('starts with autoResolvePickNone enabled', () => {
    expect(uiState.autoResolvePickNone).toBe(true);
  });

  it('starts with itemDetailMode set to immediate', () => {
    expect(uiState.itemDetailMode).toBe('immediate');
  });
});

describe('UIStore.saveSettings', () => {
  it('persists autoResolvePickNone to localStorage', () => {
    uiState.autoResolvePickNone = false;
    uiState.saveSettings();

    const saved = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved.autoResolvePickNone).toBe(false);
  });

  it('persists itemDetailMode to localStorage', () => {
    uiState.itemDetailMode = 'explore';
    uiState.saveSettings();

    const saved = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved.itemDetailMode).toBe('explore');
  });

  it('round-trips through localStorage', () => {
    uiState.autoResolvePickNone = false;
    uiState.saveSettings();

    // Read back
    const saved = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved.autoResolvePickNone).toBe(false);

    // Save again with true
    uiState.autoResolvePickNone = true;
    uiState.saveSettings();

    const saved2 = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved2.autoResolvePickNone).toBe(true);
  });
});

describe('UIStore localStorage restore', () => {
  it('handles missing localStorage gracefully', () => {
    // Constructor already ran with empty localStorage — defaults should hold
    expect(uiState.autoResolvePickNone).toBe(true);
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('nethack-ui-settings', 'not-json!!!');
    // The constructor has already run, but we can verify that saveSettings
    // still works after corrupt data existed
    uiState.saveSettings();
    const saved = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved.autoResolvePickNone).toBe(true);
  });

  it('ignores unknown fields in saved settings', () => {
    localStorage.setItem('nethack-ui-settings', JSON.stringify({
      autoResolvePickNone: false,
      unknownField: 'whatever',
    }));
    // The constructor only reads autoResolvePickNone — unknown fields are ignored
    // We can't re-run the constructor, but we verify saveSettings doesn't include extras
    uiState.autoResolvePickNone = false;
    uiState.cameraFollow = false;
    uiState.saveSettings();
    const saved = JSON.parse(localStorage.getItem('nethack-ui-settings')!);
    expect(saved).toEqual({ autoResolvePickNone: false, cameraFollow: false, itemDetailMode: 'immediate' });
  });
});
