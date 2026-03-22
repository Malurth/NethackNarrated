<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { connection } from '../services/wasm-connection';

  let lineInput = $state('');

  function handleLineSubmit() {
    const text = lineInput;
    lineInput = '';
    connection.sendLine(text);
  }

  function handleLineDismiss() {
    lineInput = '';
    connection.sendLine('');
  }

  /** Expand single-char choices into readable button labels */
  const CHOICE_LABELS: Record<string, string> = {
    y: 'Yes',
    n: 'No',
    q: 'Quit',
    a: 'All',
    ' ': 'Continue',
    '\r': 'Continue',
    '\n': 'Continue',
  };

  function choiceButtons(): { key: string; label: string }[] {
    // If we have menu items, use those
    const items = gameState.menuItems;
    const mode = gameState.menuSelectionMode;
    if (gameState.inputType === 'menu' && items && items.length > 0) {
      // PICK_NONE (display-only): just show Dismiss
      if (mode === 0 || mode === "PICK_NONE") {
        return [{ key: '\x1b', label: 'Dismiss' }];
      }
      return items
        .filter(item => item.isSelectable && item.menuChar)
        .map(item => ({
          key: item.menuChar,
          label: item.text,
        }));
    }

    // If we have yn-style choices, use those
    const raw = gameState.promptChoices;
    if (raw) {
      return raw.split('').map(ch => ({
        key: ch,
        label: CHOICE_LABELS[ch] ?? ch.toUpperCase(),
      }));
    }

    // Fallback: escape to dismiss
    return [{ key: '\x1b', label: 'Dismiss' }];
  }

  function handleChoice(key: string) {
    console.log(`[PromptBar] handleChoice: key="${key}"`);
    connection.rawKey(key).then(
      (state) => console.log(`[PromptBar] rawKey resolved, awaiting=${state.awaiting_input}`),
      (err) => console.error(`[PromptBar] rawKey error:`, err),
    );
  }
</script>

{#if gameState.awaitingInput && (gameState.prompt || (gameState.inputType === 'menu' && gameState.menuItems.length > 0) || gameState.textWindowLines.length > 0)}
  <div class="prompt-bar">
    {#if gameState.prompt}
      <span class="prompt-text">{gameState.prompt}</span>
    {/if}
    {#if gameState.inputType === 'line'}
      <div class="line-input-row">
        <input
          class="line-input"
          type="text"
          bind:value={lineInput}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') handleLineSubmit();
            if (e.key === 'Escape') handleLineDismiss();
          }}
          autofocus
        />
        <button class="choice-btn" onclick={handleLineSubmit}>Submit</button>
        <button class="choice-btn dismiss" onclick={handleLineDismiss}>Cancel</button>
      </div>
    {:else}
      {#if gameState.textWindowLines.length > 0}
        <div class="menu-text">
          {#each gameState.textWindowLines as line}
            <div class="menu-text-line">{line}</div>
          {/each}
        </div>
        <div class="prompt-buttons">
          <button class="choice-btn" onclick={() => handleChoice(' ')}>Continue</button>
        </div>
      {:else if gameState.inputType === 'menu' && (gameState.menuSelectionMode === 0 || gameState.menuSelectionMode === "PICK_NONE") && gameState.menuItems.length > 0}
        <div class="menu-text">
          {#each gameState.menuItems as item}
            <div class="menu-text-line">{item.text}</div>
          {/each}
        </div>
        <div class="prompt-buttons">
          {#each choiceButtons() as btn}
            <button class="choice-btn" onclick={() => handleChoice(btn.key)}>
              {btn.label}
              {#if btn.key.length === 1 && btn.key >= ' '}
                <span class="choice-key">({btn.key})</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="prompt-buttons">
          {#each choiceButtons() as btn}
            <button class="choice-btn" onclick={() => handleChoice(btn.key)}>
              {btn.label}
              {#if btn.key.length === 1 && btn.key >= ' '}
                <span class="choice-key">({btn.key})</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .prompt-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 10px 18px;
    background: var(--bg-highlight);
    border: 1px solid var(--accent);
    border-radius: var(--panel-radius);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .prompt-text {
    font-family: var(--font-mono);
    font-size: 16px;
    color: var(--text-bright);
    flex: 1 0 100%;
  }

  .prompt-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .choice-btn {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: #03110a;
    background: var(--accent);
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    transition: opacity 0.15s;
    text-align: left;
  }

  .choice-btn:hover {
    opacity: 0.85;
  }

  .choice-key {
    color: #0b3521;
    font-weight: 400;
    margin-left: 4px;
  }

  .menu-text {
    flex: 1 0 100%;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
  }

  .menu-text-line {
    white-space: pre-wrap;
  }

  .line-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex: 1 0 100%;
  }

  .line-input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 14px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    color: var(--text-bright);
    border: 1px solid var(--accent);
    border-radius: 4px;
    outline: none;
  }

  .line-input:focus {
    box-shadow: 0 0 4px rgba(0, 255, 136, 0.3);
  }

  .choice-btn.dismiss {
    background: transparent;
    color: var(--text-dim);
    border: 1px solid var(--border);
  }

  .choice-btn.dismiss:hover {
    color: var(--text);
  }

  @keyframes pulse {
    0%, 100% { border-color: var(--accent); }
    50% { border-color: rgba(0, 255, 136, 0.4); }
  }
</style>
