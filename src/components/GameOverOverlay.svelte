<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { llmState } from '../state/llm.svelte';
  import { resetNarrationState, clearNarrationStateForSlot } from '../services/llm-service';
  import { connection } from '../services/wasm-connection';
  import { removeSlotFromRegistry } from '../utils/save-detection';

  let { onmenu }: { onmenu: () => void } = $props();

  const wasSaved = $derived(connection.wasSaved);

  function handlePlayAgain() {
    // On death (not save), remove the slot — the character is dead
    if (!wasSaved && connection.currentSlotId) {
      removeSlotFromRegistry(connection.currentSlotId);
      clearNarrationStateForSlot(connection.currentSlotId);
    }
    gameState.reset();
    llmState.clearNarration();
    resetNarrationState();
    onmenu();
  }
</script>

{#if gameState.gameOver}
  <div class="overlay">
    {#if wasSaved}
      <div class="game-over-card saved">
        <h2 class="saved-title">Game Saved</h2>
        <p class="reason">Your progress has been saved. You can continue next time.</p>

        <button class="btn btn-primary" onclick={handlePlayAgain}>
          Return to Menu
        </button>
      </div>
    {:else}
      <div class="game-over-card">
        <h2 class="game-over-title">Game Over</h2>
        <p class="reason">{gameState.gameOverReason || 'You have died.'}</p>

        {#if gameState.player}
          <div class="final-stats">
            <div class="stat-row">
              <span class="stat-label">Score</span>
              <span class="stat-value">{gameState.player.score}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Turns</span>
              <span class="stat-value">{gameState.player.turn}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Deepest Level</span>
              <span class="stat-value">{gameState.player.dlvl}</span>
            </div>
          </div>
        {/if}

        <button class="btn btn-primary" onclick={handlePlayAgain}>
          Play Again
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: #000000cc;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .game-over-card {
    background: #0a1218;
    border: 2px solid #ff4444;
    border-radius: 6px;
    padding: 36px 52px;
    text-align: center;
    max-width: 440px;
  }

  .game-over-card.saved {
    border-color: var(--accent, #00ff88);
  }

  .game-over-title {
    font-size: 30px;
    font-weight: 700;
    color: #ff4444;
    margin: 0 0 12px;
  }

  .saved-title {
    font-size: 30px;
    font-weight: 700;
    color: var(--accent, #00ff88);
    margin: 0 0 12px;
  }

  .reason {
    font-size: 14px;
    color: #3a4a5a;
    margin: 0 0 24px;
  }

  .final-stats {
    margin: 0 0 24px;
    padding: 20px;
    background: var(--bg-secondary);
    border-radius: 4px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
  }

  .stat-label {
    color: #3a4a5a;
    font-size: 14px;
  }

  .stat-value {
    color: var(--text);
    font-weight: 600;
    font-family: var(--font-mono);
    font-size: 14px;
  }
</style>
