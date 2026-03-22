<script lang="ts">
  let { lines, ondismiss }: { lines: string[]; ondismiss: () => void } = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      ondismiss();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" onclick={ondismiss} onkeydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
  <div class="intro-card" onclick={(e: MouseEvent) => e.stopPropagation()} onkeydown={(e: KeyboardEvent) => e.stopPropagation()} role="presentation">
    <div class="intro-text">
      {#each lines as line}
        {#if line.trim() === ''}
          <br />
        {:else}
          <p>{line}</p>
        {/if}
      {/each}
    </div>
    <button class="btn btn-primary" onclick={ondismiss}>
      Continue
    </button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
    backdrop-filter: blur(4px);
  }

  .intro-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 40px;
    max-width: 560px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .intro-text {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 24px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
  }

  .intro-text p {
    margin: 0;
  }

  .intro-text br {
    display: block;
    content: "";
    margin: 8px 0;
  }
</style>
