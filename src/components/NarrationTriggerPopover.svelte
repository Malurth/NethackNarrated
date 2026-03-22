<script lang="ts">
  import { llmState } from '../state/llm.svelte';
  import {
    ALL_TRIGGERS,
    TRIGGER_LABELS,
    ALL_PRESETS,
    PRESET_LABELS,
  } from '../types/narration-triggers';
  import type { PresetName } from '../types/narration-triggers';

  let open = $state(false);
  let newPattern = $state('');
  let editingIndex = $state<number | null>(null);
  let editingValue = $state('');
  let toggleEl = $state<HTMLElement | null>(null);
  let popoverEl = $state<HTMLElement | null>(null);

  function positionPopover() {
    if (!popoverEl || !toggleEl) return;
    const btnRect = toggleEl.getBoundingClientRect();
    const top = btnRect.bottom + 6;
    const right = window.innerWidth - btnRect.right;
    popoverEl.style.top = `${top}px`;
    popoverEl.style.right = `${right}px`;
    const available = window.innerHeight - top - 12;
    popoverEl.style.maxHeight = `${Math.max(available, 80)}px`;
  }

  $effect(() => {
    if (open && popoverEl) {
      let rafId: number;
      function loop() {
        positionPopover();
        rafId = requestAnimationFrame(loop);
      }
      loop();
      return () => cancelAnimationFrame(rafId);
    }
  });

  function selectPreset(name: PresetName) {
    llmState.setPreset(name);
    llmState.saveSettings();
  }

  function toggle(trigger: (typeof ALL_TRIGGERS)[number]) {
    llmState.toggleTrigger(trigger);
    llmState.saveSettings();
  }

  function addPattern() {
    llmState.addIgnoredPattern(newPattern);
    llmState.saveSettings();
    newPattern = '';
  }

  function removePattern(pattern: string) {
    llmState.removeIgnoredPattern(pattern);
    llmState.saveSettings();
  }

  function startEditing(index: number) {
    editingIndex = index;
    editingValue = llmState.triggerConfig.ignoredMessagePatterns[index];
  }

  function commitEdit() {
    if (editingIndex === null) return;
    const trimmed = editingValue.trim();
    if (trimmed) {
      llmState.updateIgnoredPattern(editingIndex, trimmed);
      llmState.saveSettings();
    }
    editingIndex = null;
    editingValue = '';
  }

  function cancelEdit() {
    editingIndex = null;
    editingValue = '';
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.trigger-popover-wrapper')) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });

  const displayLabel = $derived(
    llmState.triggerConfig.activePreset === 'custom'
      ? 'Custom'
      : PRESET_LABELS[llmState.triggerConfig.activePreset]
  );

  const dotClass = $derived(
    llmState.triggerConfig.activePreset === 'off' ? 'off' : llmState.isNarrationEnabled ? 'on' : 'off'
  );
</script>

<div class="trigger-popover-wrapper">
  <button
    class="mode-toggle"
    bind:this={toggleEl}
    onclick={() => (open = !open)}
    title="Configure narration triggers"
  >
    <span class="mode-dot {dotClass}"></span>
    {displayLabel}
  </button>

  {#if open}
    <div class="popover" bind:this={popoverEl}>
      <div class="presets">
        {#each ALL_PRESETS as preset}
          <button
            class="preset-btn"
            class:active={llmState.triggerConfig.activePreset === preset}
            onclick={() => selectPreset(preset)}
          >
            {PRESET_LABELS[preset]}
          </button>
        {/each}
      </div>

      <div class="divider"></div>

      <div class="triggers">
        {#each ALL_TRIGGERS as trigger}
          <label class="trigger-row">
            <input
              type="checkbox"
              checked={llmState.triggerConfig.triggers[trigger]}
              onchange={() => toggle(trigger)}
            />
            <span>{TRIGGER_LABELS[trigger]}</span>
          </label>
        {/each}
      </div>

      <div class="divider"></div>

      <div class="ignored-section">
        <div class="ignored-header">Ignored Messages</div>
        {#each llmState.triggerConfig.ignoredMessagePatterns as pattern, i}
          <div class="ignored-row">
            {#if editingIndex === i}
              <form class="edit-form" onsubmit={(e) => { e.preventDefault(); commitEdit(); }}>
                <input
                  type="text"
                  class="pattern-input edit-input"
                  bind:value={editingValue}
                  onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                />
              </form>
            {:else}
              <span class="ignored-pattern">{pattern}</span>
              <div class="row-actions">
                <button class="icon-btn" onclick={() => startEditing(i)} title="Edit">&#9998;</button>
                <button class="icon-btn remove" onclick={() => removePattern(pattern)} title="Remove">&times;</button>
              </div>
            {/if}
          </div>
        {/each}
        <form class="add-pattern" onsubmit={(e) => { e.preventDefault(); addPattern(); }}>
          <input
            type="text"
            class="pattern-input"
            placeholder="e.g. You see here *"
            bind:value={newPattern}
          />
          <button type="submit" class="add-btn" disabled={!newPattern.trim()}>Add</button>
        </form>
        <div class="pattern-hint">Use * as wildcard</div>
      </div>
    </div>
  {/if}
</div>

<style>
  .trigger-popover-wrapper {
    position: relative;
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 12px;
    color: #445566;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: border-color 0.2s;
  }

  .mode-toggle:hover {
    border-color: var(--accent);
  }

  .mode-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transition: background-color 0.2s;
  }

  .mode-dot.on {
    background: var(--hp-bar);
  }

  .mode-dot.off {
    background: var(--text-dim);
  }

  .popover {
    position: fixed;
    z-index: 100;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    min-width: 220px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow-y: auto;
  }

  .presets {
    display: flex;
    gap: 4px;
  }

  .preset-btn {
    flex: 1;
    padding: 4px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: #556677;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .preset-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .preset-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(0, 255, 136, 0.05);
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 8px 0;
  }

  .triggers {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trigger-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #778899;
    cursor: pointer;
    padding: 2px 0;
  }

  .trigger-row:hover {
    color: #99aabb;
  }

  .trigger-row input[type="checkbox"] {
    accent-color: var(--accent);
    margin: 0;
  }

  .ignored-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ignored-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #556677;
  }

  .ignored-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 2px 0;
  }

  .ignored-pattern {
    font-size: 11px;
    color: #778899;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #556677;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0 2px;
  }

  .icon-btn:hover {
    color: var(--accent);
  }

  .icon-btn.remove:hover {
    color: #cc5555;
  }

  .edit-form {
    flex: 1;
    min-width: 0;
  }

  .edit-input {
    width: 100%;
  }

  .add-pattern {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }

  .pattern-input {
    flex: 1;
    font-size: 11px;
    font-family: monospace;
    padding: 3px 6px;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: #99aabb;
    outline: none;
    min-width: 0;
  }

  .pattern-input:focus {
    border-color: var(--accent);
  }

  .pattern-input::placeholder {
    color: #445566;
  }

  .add-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: #556677;
    cursor: pointer;
    flex-shrink: 0;
  }

  .add-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .pattern-hint {
    font-size: 10px;
    color: #445566;
    font-style: italic;
  }
</style>
