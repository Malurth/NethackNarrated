<script lang="ts">
  import { uiState } from '../state/ui.svelte';
  import { llmState } from '../state/llm.svelte';
  import { testLLMConnection } from '../services/llm-service';
  import { derivePalette, DEFAULT_NARRATION_HUE, DEFAULT_ANALYSIS_HUE, DEFAULT_NARRATION_INTENSITY, DEFAULT_ANALYSIS_INTENSITY } from '../utils/color-derive';

  function resetColors() {
    llmState.narrationHue = DEFAULT_NARRATION_HUE;
    llmState.narrationIntensity = DEFAULT_NARRATION_INTENSITY;
    llmState.analysisHue = DEFAULT_ANALYSIS_HUE;
    llmState.analysisIntensity = DEFAULT_ANALYSIS_INTENSITY;
  }

  let testResult = $state('');
  let testing = $state(false);

  const PROVIDERS = [
    { value: 'anthropic', label: 'Anthropic', defaultNarrator: 'claude-haiku-4-5-20251001', defaultAnalysis: 'claude-sonnet-4-20250514', keyUrl: 'https://console.anthropic.com/settings/keys',
      models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20241022', 'claude-opus-4-20250514'] },
    { value: 'openai', label: 'OpenAI', defaultNarrator: 'gpt-4o-mini', defaultAnalysis: 'gpt-4o', keyUrl: 'https://platform.openai.com/api-keys',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini'] },
    { value: 'google', label: 'Google', defaultNarrator: 'gemini-2.0-flash', defaultAnalysis: 'gemini-2.5-pro', keyUrl: 'https://aistudio.google.com/apikey',
      models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'] },
    { value: 'groq', label: 'Groq', defaultNarrator: 'llama-3.3-70b-versatile', defaultAnalysis: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'] },
    { value: 'xai', label: 'xAI', defaultNarrator: 'grok-2-latest', defaultAnalysis: 'grok-2-latest', keyUrl: 'https://console.x.ai/',
      models: ['grok-2-latest', 'grok-3', 'grok-3-mini'] },
    { value: 'deepseek', label: 'DeepSeek', defaultNarrator: 'deepseek-chat', defaultAnalysis: 'deepseek-reasoner', keyUrl: 'https://platform.deepseek.com/api_keys',
      models: ['deepseek-chat', 'deepseek-reasoner'] },
    { value: 'ollama', label: 'Ollama', defaultNarrator: 'llama3.2', defaultAnalysis: 'llama3.2', keyUrl: '',
      models: ['llama3.2', 'llama3.1', 'mistral', 'gemma2', 'phi3', 'qwen2.5'] },
    { value: 'none', label: 'None (debug)', defaultNarrator: 'none', defaultAnalysis: 'none', keyUrl: '',
      models: ['none'] },
  ];

  let currentProvider = $derived(PROVIDERS.find(p => p.value === llmState.provider));

  function onProviderChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    llmState.provider = value;
    const provider = PROVIDERS.find(p => p.value === value);
    if (provider) {
      llmState.narratorModel = provider.defaultNarrator;
      llmState.analysisModel = provider.defaultAnalysis;
    }
  }

  function save() {
    llmState.saveSettings();
    uiState.saveSettings();
    uiState.settingsOpen = false;
  }

  async function testLLM() {
    testing = true;
    testResult = '';
    try {
      const result = await testLLMConnection();
      testResult = `OK: ${result}`;
    } catch (err: any) {
      testResult = `Error: ${err.message || err}`;
    } finally {
      testing = false;
    }
  }

  function handleFocus() {
    uiState.keyboardEnabled = false;
  }

  function handleBlur() {
    uiState.keyboardEnabled = true;
  }
</script>

{#if uiState.settingsOpen}
  <div class="overlay" onclick={save} role="presentation">
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={save}>&times;</button>
      </div>
      <div class="modal-body">
        <section class="section">
          <h3>LLM Configuration</h3>
          <div class="field">
            <label for="provider">Provider</label>
            <select id="provider" value={llmState.provider} onchange={onProviderChange} onfocus={handleFocus} onblur={handleBlur}>
              {#each PROVIDERS as p}
                <option value={p.value}>{p.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="narrator-model">Narrator Model <span class="model-hint">recommended: fast, no-thinking</span></label>
            <select id="narrator-model" bind:value={llmState.narratorModel} onfocus={handleFocus} onblur={handleBlur}>
              {#each currentProvider?.models ?? [] as model}
                <option value={model}>{model}</option>
              {/each}
              {#if currentProvider && !currentProvider.models.includes(llmState.narratorModel)}
                <option value={llmState.narratorModel}>{llmState.narratorModel}</option>
              {/if}
            </select>
          </div>

          <div class="field">
            <label for="analysis-model">Analysis Model <span class="model-hint">recommended: smarter, deeper</span></label>
            <select id="analysis-model" bind:value={llmState.analysisModel} onfocus={handleFocus} onblur={handleBlur}>
              {#each currentProvider?.models ?? [] as model}
                <option value={model}>{model}</option>
              {/each}
              {#if currentProvider && !currentProvider.models.includes(llmState.analysisModel)}
                <option value={llmState.analysisModel}>{llmState.analysisModel}</option>
              {/if}
            </select>
          </div>

          <div class="field">
            <label for="api-key">
              API Key
              {#if currentProvider?.keyUrl}
                <a class="key-link" href={currentProvider.keyUrl} target="_blank" rel="noopener">Get key &rarr;</a>
              {:else if currentProvider?.value === 'ollama'}
                <span class="key-hint">No key needed (local)</span>
              {/if}
            </label>
            <input
              id="api-key"
              type="password"
              bind:value={llmState.apiKey}
              placeholder="Enter your API key"
              onfocus={handleFocus}
              onblur={handleBlur}
            />
          </div>

          <div class="test-row">
            <button class="btn btn-small" onclick={testLLM} disabled={testing || !llmState.apiKey}>
              {testing ? 'Testing...' : 'Test LLM'}
            </button>
            {#if testResult}
              <span class="test-result" class:success={testResult.startsWith('OK')} class:error={testResult.startsWith('Error')}>
                {testResult}
              </span>
            {/if}
          </div>
        </section>

        <section class="section">
          <h3>Colors</h3>
          <div class="color-group">
            <span class="color-group-label">Narration</span>
            <div class="color-row">
              <label for="narration-hue">Hue</label>
              <input id="narration-hue" type="range" min="0" max="360" class="hue-slider"
                bind:value={llmState.narrationHue} />
              <span class="hue-preview" style="background:{derivePalette(llmState.narrationHue, llmState.narrationIntensity).border}"></span>
            </div>
            <div class="color-row">
              <label for="narration-intensity">Intensity</label>
              <input id="narration-intensity" type="range" min="0" max="200" class="intensity-slider"
                bind:value={llmState.narrationIntensity}
                style="--slider-hue:{llmState.narrationHue}" />
            </div>
          </div>
          <div class="color-group">
            <span class="color-group-label">Analysis</span>
            <div class="color-row">
              <label for="analysis-hue">Hue</label>
              <input id="analysis-hue" type="range" min="0" max="360" class="hue-slider"
                bind:value={llmState.analysisHue} />
              <span class="hue-preview" style="background:{derivePalette(llmState.analysisHue, llmState.analysisIntensity).border}"></span>
            </div>
            <div class="color-row">
              <label for="analysis-intensity">Intensity</label>
              <input id="analysis-intensity" type="range" min="0" max="200" class="intensity-slider"
                bind:value={llmState.analysisIntensity}
                style="--slider-hue:{llmState.analysisHue}" />
            </div>
          </div>
          <button class="btn btn-small reset-colors-btn" onclick={resetColors}>Reset to defaults</button>
        </section>

        <section class="section">
          <h3>Game</h3>
          <label class="toggle-row">
            <input type="checkbox" bind:checked={uiState.autoResolvePickNone} />
            Auto-dismiss info menus
            <span class="toggle-hint">Convert display-only menus (e.g. far-look help) into non-blocking messages. Takes effect on next game start.</span>
          </label>
        </section>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" onclick={save}>Save & Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 70;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    color: var(--accent);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 24px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text);
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .section {
    margin-bottom: 24px;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .field {
    margin-bottom: 12px;
  }

  .field label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    margin-bottom: 4px;
  }

  .key-link {
    font-size: 11px;
    font-weight: 400;
    color: var(--accent);
    text-decoration: none;
    margin-left: auto;
  }

  .key-link:hover {
    text-decoration: underline;
  }

  .model-hint {
    font-size: 11px;
    font-weight: 400;
    color: #445566;
    margin-left: auto;
  }

  .key-hint {
    font-size: 11px;
    font-weight: 400;
    color: #445566;
    margin-left: auto;
  }

  .field input,
  .field select {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 14px;
    box-sizing: border-box;
  }

  .field input:focus,
  .field select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .test-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .test-result {
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .test-result.success {
    color: var(--hp-bar);
  }

  .test-result.error {
    color: var(--hp-bar-danger);
  }

  .color-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .color-row label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    width: 80px;
  }

  .hue-slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background: linear-gradient(to right,
      hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%),
      hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%)
    );
    cursor: pointer;
    outline: none;
  }

  .hue-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    border: 2px solid var(--bg-panel);
    cursor: pointer;
  }

  .hue-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    border: 2px solid var(--bg-panel);
    cursor: pointer;
  }

  .hue-preview {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .reset-colors-btn {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-dim);
    border-color: var(--border);
  }

  .reset-colors-btn:hover {
    color: var(--text);
  }

  .color-group {
    margin-bottom: 12px;
  }

  .color-group-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    display: block;
    margin-bottom: 4px;
  }

  .intensity-slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background: linear-gradient(to right,
      hsl(var(--slider-hue), 0%, 40%),
      hsl(var(--slider-hue), 100%, 50%)
    );
    cursor: pointer;
    outline: none;
  }

  .intensity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    border: 2px solid var(--bg-panel);
    cursor: pointer;
  }

  .intensity-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    border: 2px solid var(--bg-panel);
    cursor: pointer;
  }

  .toggle-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text);
    cursor: pointer;
  }

  .toggle-row input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .toggle-hint {
    flex-basis: 100%;
    font-size: 12px;
    color: var(--text-dim);
  }

  .modal-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
</style>
