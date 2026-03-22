<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { uiState } from '../state/ui.svelte';
  import { friendlyConditionName } from '../services/llm-service';

  // Raw condition names as emitted by @neth4ck/api (lowercase bit names)
  const DANGEROUS_CONDITIONS = new Set(['stone', 'slime', 'strngl', 'foodpois', 'termill', 'parlyz', 'unconsc']);
  const WARNING_CONDITIONS = new Set(['stun', 'conf', 'hallu', 'blind', 'deaf', 'grab', 'held', 'inlava', 'submerged', 'trapped']);

  function conditionClass(condition: string): string {
    if (DANGEROUS_CONDITIONS.has(condition)) return 'danger';
    if (WARNING_CONDITIONS.has(condition)) return 'warning';
    return 'info';
  }
</script>

<footer class="status-footer">
  <div class="footer-left">
    {#if gameState.conditions.length > 0}
      <div class="conditions">
        {#each gameState.conditions as cond}
          <span class="condition {conditionClass(cond)}">{friendlyConditionName(cond)}</span>
        {/each}
      </div>
    {/if}
    {#if gameState.player}
      <span class="stat">Score:{gameState.player.score}</span>
    {/if}
  </div>

  <div class="footer-right">
    <button class="btn btn-small" onclick={() => uiState.settingsOpen = true}>
      Settings
    </button>
  </div>
</footer>

<style>
  .status-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 18px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .conditions {
    display: flex;
    gap: 6px;
  }

  .condition {
    font-size: 12px;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 2px;
    font-family: var(--font-mono);
  }

  .condition.danger {
    color: #ff4444;
    background: #ff444422;
  }

  .condition.warning {
    color: #ffaa00;
    background: #ffaa0022;
  }

  .condition.info {
    color: #88ccff;
    background: #88ccff22;
  }

  .stat {
    font-family: var(--font-mono);
    font-size: 13px;
    color: #334455;
  }

  .footer-right {
    display: flex;
    gap: 8px;
  }
</style>
