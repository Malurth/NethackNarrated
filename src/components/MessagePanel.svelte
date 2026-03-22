<script lang="ts">
  import { gameState } from '../state/game.svelte';

  let scrollContainer: HTMLDivElement;

  // Auto-scroll to bottom when new messages arrive
  $effect(() => {
    if (gameState.messageHistory.length > 0 && scrollContainer) {
      // Wait for DOM update
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
    }
  });
</script>

<div class="message-panel">
  <div class="panel-header">Messages</div>
  <div class="messages" bind:this={scrollContainer}>
    {#if gameState.messages.length > 0}
      <div class="current-messages">
        {#each gameState.messages as msg}
          <div class="message current">{msg}</div>
        {/each}
      </div>
    {/if}
    {#if gameState.messageHistory.length === 0 && gameState.messages.length === 0}
      <div class="message dim">No messages yet.</div>
    {/if}
  </div>
</div>

<style>
  .message-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 0;
    flex-shrink: 0;
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
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    font-family: var(--font-mono);
    font-size: 14px;
    min-height: 0;
  }

  .message {
    color: var(--game-msg);
    padding: 1px 0;
    line-height: 1.4;
    font-style: italic;
  }

  .message.current {
    color: var(--game-msg);
  }

  .message.dim {
    color: #1e2e3e;
    font-style: italic;
  }
</style>
