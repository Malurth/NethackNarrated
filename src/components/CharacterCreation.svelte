<script lang="ts">
  import { connection } from '../services/wasm-connection';
  import { gameState } from '../state/game.svelte';
  import { llmState } from '../state/llm.svelte';
  import { resetNarrationState, clearNarrationStateForSlot } from '../services/llm-service';
  import { uiState } from '../state/ui.svelte';
  import {
    loadSlotRegistry,
    validateSlots,
    deleteSlotSaveData,
    removeSlotFromRegistry,
  } from '../utils/save-detection';
  import {
    getValidRaces,
    getValidAlignments,
    getValidGenders,
    getValidRoles,
  } from '@neth4ck/api';
  import type { NethackRuntimeVersion, SaveSlot } from '../types/game';

  let { onstart }: { onstart: () => void } = $props();

  // ── State ──
  let view = $state<'slots' | 'create'>('slots');
  let slots = $state<SaveSlot[]>([]);
  let loading = $state(true);

  // Character creation fields
  let playerName = $state('');
  let petName = $state('');
  let role = $state('random');
  let race = $state('random');
  let align = $state('random');
  let gender = $state('random');
  let nethackVersion = $state<NethackRuntimeVersion>('3.7');
  let skipTutorial = $state(true);

  // ── Constraint-filtered options ──
  const activeRole = $derived(role !== 'random' ? role : undefined);
  const activeRace = $derived(race !== 'random' ? race : undefined);

  const validRoles = $derived(getValidRoles({ race: activeRace as any, align: (align !== 'random' ? align : undefined) as any, gender: (gender !== 'random' ? gender : undefined) as any }));
  const validRaces = $derived(getValidRaces(activeRole as any));
  const validAligns = $derived(getValidAlignments(activeRole as any, activeRace as any));
  const validGenders = $derived(getValidGenders(activeRole as any));

  // Reset dependent fields when they become invalid
  $effect(() => { if (race !== 'random' && !validRaces.includes(race as any)) race = 'random'; });
  $effect(() => { if (align !== 'random' && !validAligns.includes(align as any)) align = 'random'; });
  $effect(() => { if (gender !== 'random' && !validGenders.includes(gender as any)) gender = 'random'; });
  $effect(() => { if (role !== 'random' && !validRoles.includes(role as any)) role = 'random'; });

  // ── Load slots on mount ──
  async function refreshSlots() {
    loading = true;
    const raw = loadSlotRegistry();
    slots = await validateSlots(raw);
    loading = false;
    // If no slots, go straight to create
    if (slots.length === 0) view = 'create';
  }
  refreshSlots();

  // Delete confirmation
  let confirmingDelete = $state<SaveSlot | null>(null);

  // ── Actions ──
  async function continueSlot(slot: SaveSlot) {
    gameState.reset();
    llmState.clearNarration();
    resetNarrationState();
    await connection.reset({ slotId: slot.slotId }, slot.version);
    onstart();
  }

  function requestDelete(slot: SaveSlot) {
    confirmingDelete = slot;
  }

  async function confirmDelete() {
    if (!confirmingDelete) return;
    const slot = confirmingDelete;
    confirmingDelete = null;
    removeSlotFromRegistry(slot.slotId);
    clearNarrationStateForSlot(slot.slotId);
    await deleteSlotSaveData(slot);
    await refreshSlots();
  }

  function cancelDelete() {
    confirmingDelete = null;
  }

  async function startGame() {
    gameState.reset();
    llmState.clearNarration();
    resetNarrationState();
    const trimmedName = playerName.trim();
    const trimmedPet = petName.trim();
    await connection.reset({
      name: trimmedName || undefined,
      petName: trimmedPet || undefined,
      role: role !== 'random' ? role : undefined,
      race: race !== 'random' ? race : undefined,
      align: align !== 'random' ? align : undefined,
      gender: gender !== 'random' ? gender : undefined,
      skipTutorial,
    }, nethackVersion);
    onstart();
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  const ROLES = [
    { value: 'random', label: 'Random' },
    { value: 'arc', label: 'Archeologist' },
    { value: 'bar', label: 'Barbarian' },
    { value: 'cav', label: 'Caveman' },
    { value: 'hea', label: 'Healer' },
    { value: 'kni', label: 'Knight' },
    { value: 'mon', label: 'Monk' },
    { value: 'pri', label: 'Priest' },
    { value: 'ran', label: 'Ranger' },
    { value: 'rog', label: 'Rogue' },
    { value: 'sam', label: 'Samurai' },
    { value: 'tou', label: 'Tourist' },
    { value: 'val', label: 'Valkyrie' },
    { value: 'wiz', label: 'Wizard' },
  ];

  const RACES = [
    { value: 'random', label: 'Random' },
    { value: 'hum', label: 'Human' },
    { value: 'elf', label: 'Elf' },
    { value: 'dwa', label: 'Dwarf' },
    { value: 'gno', label: 'Gnome' },
    { value: 'orc', label: 'Orc' },
  ];

  const ALIGNMENTS = [
    { value: 'random', label: 'Random' },
    { value: 'law', label: 'Lawful' },
    { value: 'neu', label: 'Neutral' },
    { value: 'cha', label: 'Chaotic' },
  ];

  const GENDERS = [
    { value: 'random', label: 'Random' },
    { value: 'mal', label: 'Male' },
    { value: 'fem', label: 'Female' },
  ];
</script>

<div class="overlay">
  <div class="card">
    <button class="card-settings-btn" onclick={() => uiState.settingsOpen = true}>
      Settings
    </button>
    {#if loading}
      <p class="loading">Loading...</p>
    {:else if view === 'slots'}
      <!-- ── Slot List ── -->
      <h2 class="title">Your Adventures</h2>

      {#if slots.length > 0}
        <div class="slot-list">
          {#each slots as slot (slot.slotId)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="slot-card" onclick={() => continueSlot(slot)}>
              <div class="slot-info">
                <span class="slot-name">{slot.title || slot.name}</span>
                {#if slot.role || slot.race}
                  <span class="slot-identity">{[slot.alignment, slot.gender, slot.race, slot.role].filter(Boolean).join(' ')}</span>
                {/if}
                <div class="slot-details">
                  <span>v{slot.version}</span>
                  <span>Dlvl {slot.dlvl}</span>
                  <span>T:{slot.turn}</span>
                  <span>{formatDate(slot.date)}</span>
                </div>
              </div>
              <button class="slot-delete" title="Delete save" onclick={(e) => { e.stopPropagation(); requestDelete(slot); }}>
                &#x1F5D1;
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty">No saved adventures found.</p>
      {/if}

      <button class="btn btn-primary btn-large new-game-btn" onclick={() => view = 'create'}>
        + New Adventure
      </button>

    {:else}
      <!-- ── Character Creation ── -->
      {#if slots.length > 0}
        <button class="back-btn" onclick={() => view = 'slots'}>&#8592; Back</button>
      {/if}

      <h2 class="title">New Game</h2>
      <p class="subtitle">Choose your character or let fate decide.</p>

      <div class="create-form">
        <div class="name-fields">
          <div class="field">
            <label for="player-name">Player Name</label>
            <input id="player-name" type="text" bind:value={playerName} placeholder="Player" maxlength="32" />
          </div>
          <div class="field">
            <label for="pet-name">Pet Name</label>
            <input id="pet-name" type="text" bind:value={petName} placeholder="(default)" maxlength="32" />
          </div>
        </div>

        <div class="fields" style="grid-template-columns: 1fr; margin-bottom: 12px;">
          <div class="field">
            <label for="version">NetHack Version</label>
            <select id="version" bind:value={nethackVersion}>
              <option value="3.7">3.7 (Recommended)</option>
              <option value="3.6.7">3.6.7 (Classic)</option>
            </select>
          </div>
        </div>

        <div class="fields">
          <div class="field">
            <label for="role">Role</label>
            <select id="role" bind:value={role} onfocus={() => {}} onblur={() => {}}>
              {#each ROLES as r}
                <option value={r.value} disabled={r.value !== 'random' && !validRoles.includes(r.value)}>{r.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="race">Race</label>
            <select id="race" bind:value={race}>
              {#each RACES as r}
                <option value={r.value} disabled={r.value !== 'random' && !validRaces.includes(r.value)}>{r.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="align">Alignment</label>
            <select id="align" bind:value={align}>
              {#each ALIGNMENTS as a}
                <option value={a.value} disabled={a.value !== 'random' && !validAligns.includes(a.value)}>{a.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="gender">Gender</label>
            <select id="gender" bind:value={gender}>
              {#each GENDERS as g}
                <option value={g.value} disabled={g.value !== 'random' && !validGenders.includes(g.value)}>{g.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <label class="toggle-field">
          <input type="checkbox" bind:checked={skipTutorial} />
          Skip tutorial
        </label>

        <button class="btn btn-primary btn-large" onclick={startGame}>
          Begin Adventure
        </button>
      </div>
    {/if}
  </div>

  {#if confirmingDelete}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_interactive_supports_focus, a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" onclick={cancelDelete}>
      <div class="confirm-card" onclick={(e) => e.stopPropagation()}>
        <h3 class="confirm-title">Delete Save?</h3>
        <p class="confirm-text">
          "{confirmingDelete.title || confirmingDelete.name}" will be permanently deleted.
        </p>
        <div class="confirm-actions">
          <button class="btn btn-small" onclick={cancelDelete}>Cancel</button>
          <button class="btn btn-danger btn-small" onclick={confirmDelete}>Delete</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    backdrop-filter: blur(4px);
  }

  .card {
    position: relative;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    text-align: center;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    max-height: 90vh;
    overflow-y: auto;
  }

  .card-settings-btn {
    position: absolute;
    top: 12px;
    right: 16px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
  }

  .card-settings-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .title {
    font-size: 24px;
    font-weight: 700;
    color: var(--accent);
    margin: 0 0 16px;
  }

  .subtitle {
    color: var(--text-dim);
    font-size: 13px;
    margin: -8px 0 16px;
  }

  .create-form {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin: 0 -8px -8px;
    text-align: left;
  }

  .create-form .btn-large {
    width: 100%;
    margin-top: 4px;
  }

  /* Override input/select backgrounds inside the form card
     so they contrast against bg-secondary */
  .create-form input,
  .create-form select {
    background: #071018 !important;
  }

  .loading, .empty {
    color: var(--text-dim);
    font-size: 14px;
    margin: 16px 0 24px;
  }

  /* ── Slot List ── */

  .slot-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }

  .slot-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .slot-card:hover {
    border-color: var(--accent);
  }

  .slot-info {
    flex: 1;
    min-width: 0;
    line-height: 1.3;
  }

  .slot-name {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .slot-identity {
    display: block;
    font-size: 11px;
    color: var(--accent);
  }

  .slot-details {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }

  .slot-delete {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 4px;
    color: #ff4444;
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  .slot-delete:hover {
    opacity: 1;
  }

  .btn-danger {
    background: transparent;
    border: 1px solid #ff4444;
    color: #ff4444;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .btn-danger:hover {
    background: #ff4444;
    color: white;
  }

  .new-game-btn {
    width: 100%;
  }

  .back-btn {
    position: absolute;
    top: 12px;
    left: 16px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
  }

  .back-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  /* ── Character Creation ── */

  .name-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }

  .name-fields input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-mono);
    box-sizing: border-box;
  }

  .name-fields input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .name-fields input::placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }

  .field {
    text-align: left;
  }

  .field label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
    margin-bottom: 3px;
  }

  .field select {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .field select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .field select option:disabled {
    color: var(--text-dim);
    opacity: 0.4;
  }

  .toggle-field {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--text-dim);
    cursor: pointer;
  }

  .toggle-field input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  /* ── Delete Confirmation ── */

  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .confirm-card {
    background: var(--bg-panel);
    border: 2px solid #ff4444;
    border-radius: 8px;
    padding: 24px 32px;
    text-align: center;
    max-width: 360px;
    width: 100%;
  }

  .confirm-title {
    font-size: 18px;
    font-weight: 700;
    color: #ff4444;
    margin: 0 0 8px;
  }

  .confirm-text {
    font-size: 14px;
    color: var(--text-dim);
    margin: 0 0 20px;
  }

  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
</style>
