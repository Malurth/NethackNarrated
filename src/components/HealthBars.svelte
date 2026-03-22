<script lang="ts">
  import { gameState } from '../state/game.svelte';

  let hpPercent = $derived(
    gameState.player ? (gameState.player.hp / gameState.player.max_hp) * 100 : 100
  );
  let pwPercent = $derived(
    gameState.player && gameState.player.max_pw > 0
      ? (gameState.player.pw / gameState.player.max_pw) * 100
      : 100
  );
  let hpColor = $derived(
    hpPercent > 50 ? 'var(--hp-bar)' : hpPercent > 25 ? 'var(--hp-bar-warn)' : 'var(--hp-bar-danger)'
  );
</script>

{#if gameState.player}
  <div class="health-bars">
    <div class="bar-group">
      <span class="bar-label hp-label">HP:<strong>{gameState.player.hp}</strong>/{gameState.player.max_hp}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: {hpPercent}%; background: {hpColor}"></div>
      </div>
    </div>
    <div class="bar-group">
      <span class="bar-label pw-label">Pw:<strong>{gameState.player.pw}</strong>/{gameState.player.max_pw}</span>
      <div class="bar-track">
        <div class="bar-fill pw-fill" style="width: {pwPercent}%"></div>
      </div>
    </div>
    <span class="hunger" class:warning={gameState.player.hunger !== 'Normal' && gameState.player.hunger !== 'Satiated'}>
      {gameState.player.hunger}
    </span>
  </div>
{/if}

<style>
  .health-bars {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 18px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 var(--panel-radius) var(--panel-radius);
    margin: 0 var(--gap) 0;
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .bar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    max-width: 420px;
  }

  .bar-label {
    white-space: nowrap;
    min-width: 90px;
  }

  .hp-label {
    color: #3a4a5a;
  }

  .hp-label strong {
    font-weight: 700;
    color: var(--hp-bar);
  }

  .pw-label {
    color: #3a4a5a;
  }

  .pw-label strong {
    font-weight: 700;
    color: var(--pw-bar);
  }

  .bar-track {
    flex: 1;
    height: 5px;
    background: #1a2a38;
    border-radius: 2px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease, background-color 0.3s ease;
  }

  .pw-fill {
    background: var(--pw-bar);
  }

  .hunger {
    color: #2a3a4a;
    font-size: 14px;
    min-width: 70px;
    text-align: right;
  }

  .hunger.warning {
    color: #ff5544;
    font-weight: 600;
  }
</style>
