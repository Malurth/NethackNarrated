<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { connection } from '../services/wasm-connection';
  import { parseBUC, bucColor, oclassToCategory, categorySymbol, primaryActions, secondaryActions } from '../utils/item-categories';

  let expandedItem = $state<string | null>(null);
  let showMore = $state(false);

  function handleItemClick(letter: string) {
    if (expandedItem === letter) {
      expandedItem = null;
    } else {
      expandedItem = letter;
      showMore = false;
    }
  }

  function handleAction(verb: string, letter: string) {
    connection.action(`${verb}:${letter}`);
    expandedItem = null;
    showMore = false;
  }
</script>

<div class="inventory-panel">
  <div class="panel-header">Inventory</div>
  <div class="items">
    {#each gameState.inventory as item}
      {@const buc = parseBUC(item.text)}
      {@const category = oclassToCategory(item.oclass)}
      {@const symbol = categorySymbol(category)}
      {@const isExpanded = expandedItem === item.letter}
      {@const equipped = item.worn}
      <div
        class="item-wrapper"
        class:expanded={isExpanded}
        class:equipped
      >
        <div
          class="item-row"
          onclick={() => handleItemClick(item.letter)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleItemClick(item.letter); }}
          role="button"
          tabindex="-1"
          title={item.text}
        >
          <span class="item-letter" class:equipped>{item.letter}</span>
          <span class="item-symbol" style="color: {bucColor(buc)}">{symbol}</span>
          <span class="item-text" class:expanded={isExpanded} class:equipped>{item.text}</span>
          {#if buc !== 'unknown'}
            <span class="item-buc" class:blessed={buc === 'blessed'} class:cursed={buc === 'cursed'} class:uncursed={buc === 'uncursed'}>
              {buc === 'blessed' ? 'bls' : buc === 'cursed' ? 'CUR' : 'unc'}
            </span>
          {/if}
        </div>
        {#if isExpanded}
          <div class="item-actions">
            {#each primaryActions(category, equipped) as { verb, label }}
              <button class="action-btn primary" onclick={() => handleAction(verb, item.letter)}>
                {label}
              </button>
            {/each}
            <button class="action-btn more" onclick={() => showMore = !showMore}>
              {showMore ? 'Less' : 'More\u2026'}
            </button>
          </div>
          {#if showMore}
            <div class="item-actions secondary">
              {#each secondaryActions(category, equipped) as { verb, label }}
                <button class="action-btn" onclick={() => handleAction(verb, item.letter)}>
                  {label}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    {#if gameState.inventory.length === 0}
      <div class="empty">No items.</div>
    {/if}
  </div>
</div>

<style>
  .inventory-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 0;
  }

  .panel-header {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #334455;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-family: var(--font-mono);
  }

  .items {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    min-height: 0;
  }

  .item-wrapper {
    transition: background-color 0.15s;
    border-left: 2px solid transparent;
  }

  .item-wrapper.equipped {
    border-left-color: #00ff8866;
    background: rgba(0, 255, 136, 0.03);
  }

  .item-wrapper.expanded {
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border);
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.1s;
  }

  .item-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .item-letter {
    color: #2a3a4a;
    font-family: var(--font-mono);
    font-weight: 600;
    width: 14px;
    flex-shrink: 0;
  }

  .item-letter.equipped {
    color: #3a5a6a;
  }

  .item-symbol {
    font-size: 17px;
    min-width: 22px;
    text-align: center;
    line-height: 1;
  }

  .item-text {
    flex: 1;
    color: #667788;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-text.equipped {
    color: #8899aa;
    font-weight: 600;
  }

  .item-text.expanded {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }

  .item-buc {
    font-size: 12px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .item-buc.blessed {
    color: var(--buc-blessed);
  }

  .item-buc.cursed {
    color: var(--buc-cursed);
    font-weight: 700;
  }

  .item-buc.uncursed {
    color: var(--buc-uncursed);
  }

  .item-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 12px 6px 42px;
  }

  .item-actions.secondary {
    padding-top: 0;
  }

  .action-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.04);
    color: #667788;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-bright);
  }

  .action-btn.primary {
    color: #88aacc;
  }

  .action-btn.more {
    color: #445566;
    border-style: dashed;
  }

  .action-btn.more:hover {
    color: #88aacc;
  }

  .empty {
    color: var(--text-dim);
    font-style: italic;
    padding: 14px;
    font-size: 14px;
  }
</style>
