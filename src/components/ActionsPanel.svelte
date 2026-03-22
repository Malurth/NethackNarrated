<script lang="ts">
  import { connection } from '../services/wasm-connection';

  let showMore = $state(false);

  function act(action: string) {
    connection.action(action);
  }

  const MOVE_PAD = [
    { arrow: '\\', key: 'y', action: 'move_northwest' },
    { arrow: '\u2191', key: 'k', action: 'move_north' },
    { arrow: '/', key: 'u', action: 'move_northeast' },
    { arrow: '\u2190', key: 'h', action: 'move_west' },
    { arrow: '\u00B7', key: '.', action: 'wait' },
    { arrow: '\u2192', key: 'l', action: 'move_east' },
    { arrow: '/', key: 'b', action: 'move_southwest' },
    { arrow: '\u2193', key: 'j', action: 'move_south' },
    { arrow: '\\', key: 'n', action: 'move_southeast' },
  ];

  const BASIC = [
    { label: 'Pickup', key: ',', action: 'pickup' },
    { label: '\u2191 Stair', key: '<', action: 'go_up' },
    { label: '\u2193 Stair', key: '>', action: 'go_down' },
    { label: 'Search', key: 's', action: 'search' },
    { label: 'Look', key: ':', action: 'look' },
  ];

  const INTERACT = [
    { label: 'Open', key: 'o', action: 'open' },
    { label: 'Close', key: 'c', action: 'close' },
    { label: 'Kick', key: '^D', action: 'kick' },
    { label: 'Apply', key: 'a', action: 'apply' },
    { label: 'Cast', key: 'Z', action: 'cast' },
    { label: 'Fire', key: 'f', action: 'fire' },
    // Quaff and Eat are environment-interacting too: 'q' drinks from a
    // fountain you're standing on, 'e' eats a corpse on the floor. Without
    // top-level buttons these are only discoverable via the inventory
    // panel's per-item verbs — which don't help when your interaction
    // target isn't in your inventory.
    { label: 'Quaff', key: 'q', action: 'drink' },
    { label: 'Eat', key: 'e', action: 'eat' },
    { label: 'Loot', key: '#', action: 'loot' },
    { label: 'Engrave', key: 'E', action: 'engrave' },
    { label: 'Pray', key: '#', action: 'pray' },
  ];

  const UTILITY = [
    { label: 'Swap', key: 'x', action: 'swap' },
    { label: 'Esc', key: 'Esc', action: 'esc' },
    { label: 'Remove', key: 'R', action: 'remove' },
    { label: '2-wep', key: 'X', action: 'twoweapon' },
    { label: 'Disrobe', key: 'A', action: 'takeoffall' },
    { label: 'Chat', key: '#', action: 'chat' },
  ];

  const MORE_ACTIONS = [
    { label: 'Dip', key: '#', action: 'dip' },
    { label: 'Enhance', key: '#', action: 'enhance' },
    { label: 'Force', key: '#', action: 'force' },
    { label: 'Invoke', key: '#', action: 'invoke' },
    { label: 'Jump', key: '#', action: 'jump' },
    { label: 'Monster', key: '#', action: 'monster' },
    { label: 'Rub', key: '#', action: 'rub' },
    { label: 'Sit', key: '#', action: 'sit' },
    { label: 'Turn', key: '#', action: 'turn' },
    { label: 'Untrap', key: '#', action: 'untrap' },
    { label: 'Wipe', key: '#', action: 'wipe' },
    { label: 'Offer', key: '#', action: 'offer' },
    { label: 'Ride', key: '#', action: 'ride' },
    { label: 'Teleport', key: '^T', action: 'teleport' },
    { label: 'Tip', key: '#', action: 'tip' },
    { label: 'Autopick', key: '@', action: 'autopickup' },
    { label: 'Call', key: 'C', action: 'call' },
    { label: 'Pay', key: 'p', action: 'pay' },
    { label: 'Drop type', key: 'D', action: 'droptype' },
    { label: 'Fight', key: 'F', action: 'fight' },
  ];
</script>

<div class="actions-panel">
  <div class="panel-header">Actions</div>

  <div class="panel-body">
    <!-- Movement Pad -->
    <div class="move-pad">
      {#each MOVE_PAD as { arrow, key, action }}
        <button class="move-btn" onclick={() => act(action)} title={action}>
          <span class="move-arrow">{arrow}</span>
          <span class="move-key">{key}</span>
        </button>
      {/each}
    </div>

    <!-- Basic -->
    <div class="section-label">Basic</div>
    <div class="action-row">
      {#each BASIC as { label, key, action }}
        <button class="act-btn" onclick={() => act(action)} title={action}>
          {label}<span class="keyhint">{key}</span>
        </button>
      {/each}
    </div>

    <!-- Interact -->
    <div class="section-label">Interact</div>
    <div class="action-row">
      {#each INTERACT as { label, key, action }}
        <button class="act-btn" onclick={() => act(action)} title={action}>
          {label}<span class="keyhint">{key}</span>
        </button>
      {/each}
    </div>

    <!-- Utility -->
    <div class="section-label">Utility</div>
    <div class="action-row">
      {#each UTILITY as { label, key, action }}
        <button class="act-btn" onclick={() => act(action)} title={action}>
          {label}<span class="keyhint">{key}</span>
        </button>
      {/each}
    </div>

    <!-- More -->
    <button class="more-toggle" onclick={() => showMore = !showMore}>
      {showMore ? 'Less\u2026' : 'More\u2026'}
    </button>
    {#if showMore}
      <div class="action-row">
        {#each MORE_ACTIONS as { label, key, action }}
          <button class="act-btn" onclick={() => act(action)} title={action}>
            {label}<span class="keyhint">{key}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .actions-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 15px;
    flex-shrink: 100;
  }

  .panel-header {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #334455;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
  }

  .panel-body {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* Movement Pad */
  .move-pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    margin-bottom: 4px;
  }

  .move-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
    transition: background-color 0.1s;
    line-height: 1;
    min-height: 36px;
  }

  .move-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .move-btn:active {
    background: rgba(0, 255, 136, 0.1);
  }

  .move-arrow {
    font-size: 14px;
    color: #667788;
    font-family: var(--font-mono);
  }

  .move-key {
    font-size: 10px;
    color: #334455;
    font-family: var(--font-mono);
  }

  /* Section Labels */
  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #2a3a4a;
    font-family: var(--font-mono);
    padding-top: 2px;
  }

  /* Action button rows */
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .act-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 7px;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: #667788;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .act-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-bright);
  }

  .act-btn:active {
    background: rgba(0, 255, 136, 0.1);
  }

  .keyhint {
    font-size: 9px;
    color: #334455;
    font-weight: 600;
  }

  /* More toggle */
  .more-toggle {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border: 1px dashed var(--border);
    border-radius: 3px;
    background: none;
    color: #445566;
    cursor: pointer;
    align-self: flex-start;
  }

  .more-toggle:hover {
    color: #88aacc;
  }
</style>
