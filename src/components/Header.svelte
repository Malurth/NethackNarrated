<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { llmState } from '../state/llm.svelte';
  import { resetNarrationState } from '../services/llm-service';
  import { connectionState } from '../state/connection.svelte';
  import { uiState } from '../state/ui.svelte';
  import { connection } from '../services/wasm-connection';

  let { onmenu }: { onmenu: () => void } = $props();

  async function handleSave() {
    // Suppress state updates during save to prevent a Game Over flash
    const savedCallback = (connection as any).onState;
    (connection as any).onState = null;
    await connection.save();
    (connection as any).onState = savedCallback;
    gameState.reset();
    llmState.clearNarration();
    resetNarrationState();
    onmenu();
  }

  function handleNewGame() {
    if (connection.isConnected && !gameState.gameOver) {
      if (!confirm('Start a new game? Current game will be lost.')) return;
    }
    connection.reset();
    gameState.reset();
    llmState.clearNarration();
    resetNarrationState();
  }
</script>

<header class="header">
  <div class="header-left">
    <h1 class="title">NetHack<span class="version">&nbsp;{gameState.runtimeVersion}</span></h1>
    <span class="subtitle">— NethackNarrated</span>
  </div>

  <div class="header-right">
    <button class="btn btn-small" onclick={() => uiState.settingsOpen = true}>
      Settings
    </button>
    {#if connectionState.status === 'connected' && !gameState.gameOver}
      <button class="btn btn-small" onclick={handleSave}>
        Save & Quit
      </button>
    {/if}
    {#if connectionState.status === 'connected'}
      <button class="btn btn-primary btn-small" onclick={handleNewGame}>
        New Game
      </button>
    {/if}
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    border-bottom: 1px solid #1a2a38;
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .title {
    font-size: 22px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.04em;
    margin: 0;
    font-family: var(--font-mono);
  }

  .version {
    letter-spacing: 0;
  }

  .subtitle {
    font-size: 14px;
    color: #445566;
    font-family: var(--font-mono);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
