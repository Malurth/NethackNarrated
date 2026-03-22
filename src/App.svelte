<script lang="ts">
  import './app.css';
  import { connection } from './services/wasm-connection';
  import { connectionState } from './state/connection.svelte';
  import { gameState } from './state/game.svelte';
  import { uiState } from './state/ui.svelte';
  import { KEY_TO_ACTION } from './services/keyboard';
  import { maybeNarrate } from './services/llm-service';
  import type { GameState } from './types/game';

  import Header from './components/Header.svelte';
  import StatsBar from './components/StatsBar.svelte';
  import HealthBars from './components/HealthBars.svelte';
  import MapDisplay from './components/MapDisplay.svelte';
  import MessagePanel from './components/MessagePanel.svelte';
  import ActionsPanel from './components/ActionsPanel.svelte';
  import InventoryPanel from './components/InventoryPanel.svelte';
  import EntityLegend from './components/EntityLegend.svelte';
  import NarrationPanel from './components/NarrationPanel.svelte';
  import PromptBar from './components/PromptBar.svelte';
  import StatusFooter from './components/StatusFooter.svelte';
  import SettingsModal from './components/SettingsModal.svelte';

  import GameOverOverlay from './components/GameOverOverlay.svelte';
  import CharacterCreation from './components/CharacterCreation.svelte';
  import IntroModal from './components/IntroModal.svelte';

  let showCharCreate = $state(true);
  let introLines = $state<string[]>([]);
  let latestState: GameState | null = null;
  let gameStarted = false;

  // ── Resizable layout ──────────────────────────────────────────────
  const LAYOUT_KEY = 'nethack-layout-sizes';
  const LAYOUT_DEFAULTS = { leftWidth: 260, rightWidth: 320, bottomHeight: 170 };

  function loadLayout() {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) return { ...LAYOUT_DEFAULTS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...LAYOUT_DEFAULTS };
  }

  let layout = $state(loadLayout());
  let resizingEdge = $state<string | null>(null);
  let dragStartPos = 0;
  let dragStartValue = 0;

  function persistLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }

  function startResize(edge: string, event: PointerEvent) {
    resizingEdge = edge;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragStartPos = (edge === 'bottom') ? event.clientY : event.clientX;
    dragStartValue = edge === 'left' ? layout.leftWidth
      : edge === 'right' ? layout.rightWidth
      : layout.bottomHeight;
    document.body.classList.add('resizing');
    document.body.style.cursor = (edge === 'bottom') ? 'row-resize' : 'col-resize';
  }

  function onResizeMove(event: PointerEvent) {
    if (!resizingEdge) return;
    if (resizingEdge === 'left') {
      const delta = event.clientX - dragStartPos;
      layout.leftWidth = Math.max(120, Math.min(500, dragStartValue + delta));
    } else if (resizingEdge === 'right') {
      const delta = event.clientX - dragStartPos;
      layout.rightWidth = Math.max(150, Math.min(600, dragStartValue - delta));
    } else if (resizingEdge === 'bottom') {
      const delta = event.clientY - dragStartPos;
      layout.bottomHeight = Math.max(60, Math.min(500, dragStartValue - delta));
    }
  }

  function onResizeEnd() {
    if (resizingEdge) {
      resizingEdge = null;
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      persistLayout();
    }
  }

  function resetEdge(edge: string) {
    if (edge === 'left') layout.leftWidth = LAYOUT_DEFAULTS.leftWidth;
    else if (edge === 'right') layout.rightWidth = LAYOUT_DEFAULTS.rightWidth;
    else if (edge === 'bottom') layout.bottomHeight = LAYOUT_DEFAULTS.bottomHeight;
    persistLayout();
  }

  // Wire up WASM connection callbacks
  connection.setStatusCallback((status, error) => {
    connectionState.setStatus(status, error);
  });

  connection.setStateCallback((state: GameState) => {
    latestState = state;
    gameState.update(state);
    // Skip narration until handleGameStart has run (so introText is available)
    if (gameStarted) {
      maybeNarrate(state);
    }
  });

  // Auto-initialize the WASM runtime on load
  connection.connect().catch((err) => {
    console.error('Failed to initialize WASM runtime:', err);
  });

  function handleGameStart() {
    showCharCreate = false;
    const lines = connection.introText;
    // On restore, introText is empty — skip the intro modal
    if (lines.length > 0) {
      introLines = lines;
      gameState.introText = lines;
    }
    gameStarted = true;
    // Trigger the first narration now that introText is available
    if (latestState) {
      maybeNarrate(latestState);
    }
  }

  function handleReturnToMenu() {
    showCharCreate = true;
    gameStarted = false;
    latestState = null;
  }

  function handleKeydown(event: KeyboardEvent) {
    // Don't capture keys when typing in inputs, using browser shortcuts, or keyboard is disabled
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!uiState.keyboardEnabled) return;
    if (connectionState.status !== 'connected') return;
    if (gameState.gameOver) return;

    // When awaiting input (prompt), forward keypresses as raw_key
    if (gameState.awaitingInput) {
      event.preventDefault();
      if (event.key === 'Escape') {
        connection.action('esc');
      } else if (event.key.length === 1) {
        connection.rawKey(event.key);
      } else {
        // Handle arrow keys as directional responses
        const action = KEY_TO_ACTION[event.key];
        if (action) connection.action(action);
      }
      return;
    }

    // Normal gameplay: look up mapped action
    const action = KEY_TO_ACTION[event.key];
    if (action) {
      event.preventDefault();
      connection.action(action);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app">
  {#if connectionState.status === 'connected' && gameState.player}
    <!-- Game UI -->
    <Header onmenu={handleReturnToMenu} />
    <StatsBar />
    <HealthBars />

    <div class="main-layout"
      style="grid-template-columns: {layout.leftWidth}px var(--gap) 1fr var(--gap) {layout.rightWidth}px"
    >
      <div class="left-column">
        <ActionsPanel />
        <MessagePanel />
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle col-handle"
        onpointerdown={(e) => startResize('left', e)}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        ondblclick={() => resetEdge('left')}
      ></div>

      <div class="center-column">
        <MapDisplay />
        <PromptBar />
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle col-handle"
        onpointerdown={(e) => startResize('right', e)}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        ondblclick={() => resetEdge('right')}
      ></div>

      <div class="right-column">
        <InventoryPanel />
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle row-handle"
      onpointerdown={(e) => startResize('bottom', e)}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
      ondblclick={() => resetEdge('bottom')}
    ></div>

    <div class="bottom-layout"
      style="height: {layout.bottomHeight}px; grid-template-columns: {layout.leftWidth}px 1fr"
    >
      <EntityLegend />
      <NarrationPanel />
    </div>

    <StatusFooter />
  {:else}
    <!-- Welcome screen (waiting for game to start) -->
    <div class="connect-screen">
      <div class="connect-card">
        <h1 class="logo">NethackNarrated</h1>
        <p class="tagline">AI-narrated NetHack in your browser</p>

        {#if connectionState.status === 'error'}
          <p class="error">{connectionState.error || 'Failed to load WASM runtime'}</p>
        {/if}

        <button class="btn btn-small settings-btn" onclick={() => uiState.settingsOpen = true}>
          LLM Settings
        </button>
      </div>
    </div>
  {/if}

  <!-- Modals -->
  <SettingsModal />
  <GameOverOverlay onmenu={handleReturnToMenu} />

  {#if showCharCreate}
    <CharacterCreation onstart={handleGameStart} />
  {/if}

  {#if introLines.length > 0}
    <IntroModal lines={introLines} ondismiss={() => introLines = []} />
  {/if}

  <!-- Floating prompt bar — visible above all overlays for early questions (e.g. tutorial) -->
  {#if gameState.awaitingInput && gameState.prompt && !gameState.player}
    <div class="floating-prompt">
      <PromptBar />
    </div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Main 3-column layout with resize handles as grid columns */
  .main-layout {
    flex: 1;
    display: grid;
    /* grid-template-columns set via inline style */
    gap: 0;
    padding: var(--gap) var(--gap) 0 var(--gap);
    min-height: 0;
    overflow: hidden;
  }

  .left-column {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-height: 0;
    overflow: hidden;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .center-column {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-height: 0;
    overflow: hidden;
  }

  /* Resize handles — sized to fill the gap exactly */
  .resize-handle {
    background: transparent;
    transition: background 0.15s;
    z-index: 10;
  }

  .resize-handle:hover,
  .resize-handle:active {
    background: rgba(0, 255, 136, 0.15);
  }

  .col-handle {
    cursor: col-resize;
  }

  .row-handle {
    cursor: row-resize;
    height: var(--gap);
    margin: 0 var(--gap);
  }

  /* Bottom layout: entities + narration */
  .bottom-layout {
    display: grid;
    /* grid-template-columns set via inline style */
    gap: var(--gap);
    padding: 0 var(--gap) var(--gap);
    min-height: 0;
    flex-shrink: 0;
  }

  /* Connect screen */
  .connect-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .connect-card {
    text-align: center;
    max-width: 400px;
    width: 100%;
    padding: 40px;
  }

  .logo {
    font-size: 36px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 8px;
  }

  .tagline {
    color: var(--text-dim);
    font-size: 16px;
    margin-bottom: 32px;
  }

  .error {
    color: var(--hp-bar-danger);
    font-size: 13px;
    margin: 0 0 16px;
  }

  .settings-btn {
    margin-top: 8px;
  }

  .floating-prompt {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    min-width: 320px;
    max-width: 600px;
  }
</style>
