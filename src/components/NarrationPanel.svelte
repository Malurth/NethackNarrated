<script lang="ts">
  import { llmState } from '../state/llm.svelte';
  import { gameState } from '../state/game.svelte';
  import { analyze } from '../services/llm-service';
  import NarrationTriggerPopover from './NarrationTriggerPopover.svelte';
  import { derivePalette } from '../utils/color-derive';
  import { formatInlineMarkdown } from '../utils/format-markdown';
  import type { GameState } from '../types/game';

  const narrationPalette = $derived(derivePalette(llmState.narrationHue, llmState.narrationIntensity));
  const analysisPalette = $derived(derivePalette(llmState.analysisHue, llmState.analysisIntensity));

  function triggerAnalysis() {
    if (llmState.isAnalyzing || !llmState.isConfigured || !gameState.player) return;
    const currentState: GameState = {
      type: 'state',
      turn: gameState.turn,
      dlvl: gameState.dlvl,
      map: gameState.map,
      player: gameState.player,
      messages: gameState.messages,
      inventory: gameState.inventory,
      conditions: gameState.conditions,
      properties: gameState.properties,
      warnedMonsters: gameState.warnedMonsters,
      name_title: gameState.nameTitle,
      role: gameState.role,
      race: gameState.race,
      gender: gameState.gender,
      alignment: gameState.alignment,
      entities: gameState.entities,
      cursor: gameState.cursor,
      awaiting_input: gameState.awaitingInput,
      input_type: gameState.inputType,
      prompt: gameState.prompt,
      prompt_choices: gameState.promptChoices,
      menu_items: gameState.menuItems,
      menu_selection_mode: gameState.menuSelectionMode,
      text_window_lines: gameState.textWindowLines,
      game_over: gameState.gameOver,
      game_over_reason: gameState.gameOverReason,
      terrain: gameState.terrain ?? undefined,
      mapColors: gameState.mapColors,
    };
    analyze(currentState);
  }

  let scrollContainer: HTMLDivElement;

  $effect(() => {
    // Touch all three so Svelte tracks each as a dependency (no short-circuit)
    void llmState.currentNarration;
    void llmState.analysisResult;
    void llmState.entries.length;
    if (!scrollContainer) return;

    requestAnimationFrame(() => {
      const lastChild = scrollContainer.lastElementChild as HTMLElement | null;
      if (!lastChild) return;

      // How far we'd need to scroll to put the bottom of content in view
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      // How far we'd need to scroll to put the new message's top at the container's top
      const messageTopScroll = lastChild.offsetTop - scrollContainer.offsetTop;

      // Scroll as far down as possible, but never past the point where
      // the new message's first line leaves the top of the viewport
      scrollContainer.scrollTop = Math.min(maxScroll, messageTopScroll);
    });
  });
</script>

<div class="narration-panel">
  <div class="panel-header">
    <span>AI</span>
    <div class="header-controls">
      {#if llmState.isConfigured && gameState.player}
        <button
          class="analyze-btn"
          onclick={triggerAnalysis}
          disabled={llmState.isAnalyzing}
        >
          {llmState.isAnalyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      {/if}
      <NarrationTriggerPopover />
    </div>
  </div>

  <div class="feed" bind:this={scrollContainer}>
    {#if !llmState.isConfigured}
      <p class="hint">Set up an LLM API key in Settings to enable AI features.</p>
    {:else if llmState.entries.length === 0 && !llmState.currentNarration && !llmState.analysisResult}
      <p class="hint">Narration and analysis will appear here as you play.</p>
    {:else}
      {#each llmState.entries as entry}
        {@const palette = entry.kind === 'narration' ? narrationPalette : analysisPalette}
        <div
          class="entry"
          class:narration={entry.kind === 'narration'}
          class:analysis={entry.kind === 'analysis'}
          style="color:{palette.text}; border-left-color:{palette.border}; background:{palette.background}"
        >
          {@html formatInlineMarkdown(entry.text)}
        </div>
      {/each}

      {#if llmState.isGenerating && llmState.currentNarration}
        <div
          class="entry narration streaming"
          style="color:{narrationPalette.text}; border-left-color:{narrationPalette.border}; background:{narrationPalette.background}"
        >
          {@html formatInlineMarkdown(llmState.currentNarration)}<span class="cursor">|</span>
        </div>
      {/if}

      {#if llmState.isAnalyzing && llmState.analysisResult}
        <div
          class="entry analysis streaming"
          style="color:{analysisPalette.text}; border-left-color:{analysisPalette.border}; background:{analysisPalette.background}"
        >
          {@html formatInlineMarkdown(llmState.analysisResult)}<span class="cursor">|</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .narration-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #334455;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .analyze-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    color: #5599cc;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: border-color 0.2s, color 0.2s;
  }

  .analyze-btn:hover:not(:disabled) {
    border-color: #5599cc;
    color: #77bbee;
  }

  .analyze-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .feed {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .entry {
    font-size: 13px;
    line-height: 1.5;
    padding: 6px 10px;
    border-radius: 3px;
    white-space: pre-wrap;
  }

  .entry.narration {
    font-style: italic;
    border-left: 2px solid;
  }

  /* Italic emphasis within already-italic narration: revert to upright so it stands out */
  .entry.narration :global(em) {
    font-style: normal;
  }

  .entry.analysis {
    border-left: 2px solid;
  }

  .cursor {
    animation: blink 0.8s step-end infinite;
    color: var(--accent);
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .hint {
    color: #1e2e3e;
    font-size: 13px;
    font-style: italic;
    margin: 0;
  }
</style>
