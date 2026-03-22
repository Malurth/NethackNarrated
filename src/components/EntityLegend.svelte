<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { NLE_COLORS } from '../utils/colors';

  interface LegendEntry {
    char: string;
    name: string;
    color: string;
    count: number;
    pet: boolean;
    hasGivenName: boolean;
  }

  let legendEntries = $derived.by(() => {
    const map = new Map<string, LegendEntry>();

    for (const e of gameState.entities) {
      // Skip the player — we add a special entry for them
      if (gameState.player && e.x === gameState.player.x && e.y === gameState.player.y && e.char === '@') continue;

      const name = e.type === 'monster' ? e.name : (e as any).category ?? 'item';
      const key = `${e.char}-${name}`;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, {
          char: e.char,
          name,
          color: NLE_COLORS[e.color] ?? '#aaaaaa',
          count: 1,
          pet: e.type === 'monster' && e.pet,
          hasGivenName: e.type === 'monster' && !!(e as any).givenName,
        });
      }
    }

    // Add doors from terrain exits, using the actual map character and NetHack color
    if (gameState.terrain && gameState.map.length > 0) {
      for (const exit of gameState.terrain.exits) {
        if (exit.type !== 'closed door' && exit.type !== 'open door') continue;
        const row = gameState.map[exit.y];
        let mapChar = row ? row[exit.x] : '+';
        // If the player is standing on the door, the rendered map shows
        // '@' at this tile — fall back to the canonical door glyph so the
        // legend doesn't end up with `@ = open door`.
        const playerOnTile = gameState.player
          && exit.x === gameState.player.x
          && exit.y === gameState.player.y;
        if (playerOnTile || mapChar === '@') {
          mapChar = exit.type === 'open door' ? '/' : '+';
        }
        const key = `${mapChar}-${exit.type}`;
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          // Use NetHack's actual feature color if available; fall back to structural
          const color = exit.color >= 0
            ? (NLE_COLORS[exit.color] ?? '#aaaaaa')
            : '#aa8855';
          map.set(key, {
            char: mapChar,
            name: exit.type,
            color,
            count: 1,
            pet: false,
            hasGivenName: false,
          });
        }
      }
    }

    return Array.from(map.values());
  });
</script>

<div class="entity-legend">
  <div class="panel-header">On This Level</div>
  <div class="legend-hint">hover a symbol</div>
  <div class="entries-inline">
    {#if gameState.player}
      <span class="entry-inline">
        <span class="entry-char" style="color: #00ff88; text-shadow: 0 0 7px #00ff8888">@</span>
        <span class="entry-label">You</span>
      </span>
    {/if}
    {#each legendEntries as entry}
      <span class="entry-inline">
        <span class="entry-char" style="color: {entry.color}; text-shadow: 0 0 5px {entry.color}88">{entry.char}</span>
        <span class="entry-label">
          {entry.count > 1 ? `${entry.count}x ` : ''}{entry.name}{#if entry.pet && !entry.hasGivenName}&nbsp;(pet){/if}
        </span>
      </span>
    {/each}
  </div>
</div>

<style>
  .entity-legend {
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 0;
  }

  .panel-header {
    padding: 8px 14px 3px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #334455;
    font-family: var(--font-mono);
  }

  .legend-hint {
    padding: 0 14px 6px;
    font-size: 12px;
    color: #1e2e3e;
    font-style: italic;
    font-family: var(--font-mono);
    border-bottom: 1px solid var(--border);
  }

  .entries-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 10px 14px;
    font-family: var(--font-mono);
    font-size: 16px;
  }

  .entry-inline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    cursor: help;
  }

  .entry-char {
    font-weight: 700;
    width: 12px;
    flex-shrink: 0;
  }

  .entry-label {
    color: #445566;
    font-size: 12px;
  }
</style>
