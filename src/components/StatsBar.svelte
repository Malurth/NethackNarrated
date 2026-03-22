<script lang="ts">
  import { gameState } from '../state/game.svelte';
</script>

{#if gameState.player}
  <div class="stats-container">
    <div class="name-row">
      <span class="char-name">{gameState.nameTitle}</span>
      <span class="char-align">{[gameState.alignment, gameState.gender, gameState.race, gameState.role].filter(Boolean).join(' ')}</span>
      <span class="spacer"></span>
      <span class="dlvl">Dlvl:{gameState.dlvl}</span>
      <span class="turns">T:{gameState.turn}</span>
    </div>
    <div class="stats-row">
      <span class="stat"><span class="stat-label">St:</span><strong>{gameState.player.str}</strong></span>
      <span class="stat"><span class="stat-label">Dx:</span><strong style="color:#55aaff">{gameState.player.dex}</strong></span>
      <span class="stat"><span class="stat-label">Co:</span><strong>{gameState.player.con}</strong></span>
      <span class="stat"><span class="stat-label">In:</span><strong style="color:#ff88ff">{gameState.player.int}</strong></span>
      <span class="stat"><span class="stat-label">Wi:</span><strong>{gameState.player.wis}</strong></span>
      <span class="stat"><span class="stat-label">Ch:</span><strong>{gameState.player.cha}</strong></span>
      <span class="stat"><span class="stat-label">AC:</span><strong style="color:#ffcc44">{gameState.player.ac}</strong></span>
      <span class="stat"><span class="stat-label">XL:</span><strong style="color:#ff9944">{gameState.player.xp_level}</strong></span>
      <span class="stat"><span class="stat-label">$:</span><strong style="color:#ffdd44">{gameState.player.gold}</strong></span>
    </div>
  </div>
{/if}

<style>
  .stats-container {
    padding: 8px 18px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius) var(--panel-radius) 0 0;
    margin: var(--gap) var(--gap) 0;
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .name-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
  }

  .char-name {
    color: var(--accent);
    font-weight: 700;
  }

  .char-align {
    color: var(--text-dim);
  }

  .spacer {
    flex: 1;
  }

  .dlvl, .turns {
    color: #334455;
    font-size: 13px;
  }

  .stats-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .stat {
    color: #3a4a5a;
  }

  .stat-label {
    color: #3a4a5a;
  }

  .stat strong {
    color: var(--text);
    font-weight: 600;
  }
</style>
