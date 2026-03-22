class UIStore {
  settingsOpen = $state(false);
  selectedInventoryItem = $state<string | null>(null);
  /** Set to false when user is typing in an input field */
  keyboardEnabled = $state(true);
  /** Auto-dismiss display-only menus (PICK_NONE) as non-blocking messages */
  autoResolvePickNone = $state(true);

  constructor() {
    // Restore persisted game settings
    try {
      const saved = localStorage.getItem("nethack-ui-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.autoResolvePickNone !== undefined) {
          this.autoResolvePickNone = parsed.autoResolvePickNone;
        }
      }
    } catch { /* ignore */ }
  }

  saveSettings() {
    try {
      localStorage.setItem("nethack-ui-settings", JSON.stringify({
        autoResolvePickNone: this.autoResolvePickNone,
      }));
    } catch { /* ignore */ }
  }
}

export const uiState = new UIStore();
