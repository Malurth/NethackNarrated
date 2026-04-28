class UIStore {
  settingsOpen = $state(false);
  selectedInventoryItem = $state<string | null>(null);
  /** Set to false when user is typing in an input field */
  keyboardEnabled = $state(true);
  /** Auto-dismiss display-only menus (PICK_NONE) as non-blocking messages */
  autoResolvePickNone = $state(true);
  /** Legend entry key currently hovered (char-name), or null */
  hoveredLegendKey = $state<string | null>(null);
  /** Camera auto-follows the player (dead-zone style). Set to false
   *  when the user manually pans the map. */
  cameraFollow = $state(true);
  /** Item name detail mode:
   *  - "immediate": show full item names from the C engine right away (auto-farlook)
   *  - "explore": only show full names after the game has revealed them to the
   *    player (nameKnown); unexamined items show their glyph category */
  itemDetailMode = $state<"immediate" | "explore">("immediate");

  constructor() {
    // Restore persisted game settings
    try {
      const saved = localStorage.getItem("nethack-ui-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.autoResolvePickNone !== undefined) {
          this.autoResolvePickNone = parsed.autoResolvePickNone;
        }
        if (parsed.cameraFollow !== undefined) {
          this.cameraFollow = parsed.cameraFollow;
        }
        if (parsed.itemDetailMode === "immediate" || parsed.itemDetailMode === "explore") {
          this.itemDetailMode = parsed.itemDetailMode;
        }
      }
    } catch { /* ignore */ }
  }

  saveSettings() {
    try {
      localStorage.setItem("nethack-ui-settings", JSON.stringify({
        autoResolvePickNone: this.autoResolvePickNone,
        cameraFollow: this.cameraFollow,
        itemDetailMode: this.itemDetailMode,
      }));
    } catch { /* ignore */ }
  }
}

export const uiState = new UIStore();
