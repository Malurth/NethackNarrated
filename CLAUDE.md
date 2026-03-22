# NethackNarrated

A Svelte 5 frontend for playing NetHack in the browser, powered by `@neth4ck/api` (WASM) with AI-driven narration and gameplay analysis.

## Workspace Layout

This project is developed alongside `neth4ck-monorepo` (sibling directory). Both repos are open in the workspace:

| Path | Purpose |
|------|---------|
| `NethackNarrated/` | This repo - the Svelte frontend |
| `neth4ck-monorepo/` | Monorepo providing `@neth4ck/api`, `@neth4ck/neth4ck`, and WASM packages |

Dependencies use `file:` links to the local monorepo (`package.json`). After making changes in the monorepo (especially to `@neth4ck/api`), you need to reinstall for this project to pick them up:

```bash
# In neth4ck-monorepo: rebuild packages
pnpm build

# In NethackNarrated: reinstall to pick up changes
npm install
```

Source changes to `@neth4ck/api` are resolved via the `file:` symlink so they're often reflected without reinstalling, but any new exports, dependency changes, or WASM rebuilds require the reinstall step. The `npm install` also triggers `copy-wasm.mjs` via the build script when WASM assets change.

### WASM rebuilds

If you need to rebuild the WASM artifacts (e.g. after editing C source in the NetHack submodules), **do it yourself via WSL** — don't ask the user to do it. Emscripten requires a Linux environment, so builds run in WSL:

```bash
# Build 3.7:
wsl -e bash -c "source ~/emsdk/emsdk_env.sh 2>/dev/null && cd /mnt/c/Users/malur/neth4ck-monorepo/packages/wasm-37 && ./build-wasm.sh"

# Build 3.6.7:
wsl -e bash -c "source ~/emsdk/emsdk_env.sh 2>/dev/null && cd /mnt/c/Users/malur/neth4ck-monorepo/packages/wasm-367 && ./build-wasm.sh"

# Then reinstall in NethackNarrated to pick up new WASM:
cd c:/Users/malur/NethackNarrated && npm install
```

**ALWAYS run the two WASM builds in parallel** when both are needed. They're fully independent (different directories, different output files) and parallelization roughly halves the wall time. Send both `Bash` invocations in a single tool-use message — do NOT run them sequentially. The same parallelism rule applies to any other independent operations (multiple test files, fetching data, etc.).

Key points:
- Must `source ~/emsdk/emsdk_env.sh` before building (emsdk not in PATH by default)
- Build both versions if the C change affects shared code (e.g. `libnhmain.c`) — and **build them in parallel**
- The C source lives in git submodules: `packages/wasm-37/NetHack/` and `packages/wasm-367/NetHack/`
- 3.7 uses `svp.` prefix for globals (e.g. `svp.pl_character`), 3.6.7 uses bare names (e.g. `pl_character`)
- Build output: `packages/wasm-{version}/build/nethack.{js,wasm}`
- Use `timeout: 600000` for build commands (can take several minutes)
- The build scripts now `touch` all source files before `make` to work around WSL/Windows clock skew — no need to do this manually anymore

### GitHub structure

The monorepo is a fork of [apowers313/neth4ck-monorepo](https://github.com/apowers313/neth4ck-monorepo). Its WASM packages contain git submodules pointing to [Malurth/NetHack](https://github.com/Malurth/NetHack) (a fork of apowers313/NetHack). Changes to C source in the submodules must be pushed to that fork separately.

### Committing changes (any repo)

When the user asks for commit messages, present them as **standalone copyable code blocks** (the user pastes them directly into the VS Code commit GUI). Do NOT wrap them in `git commit -m` invocations or include the staging step. Each commit message gets its own fenced code block with no shell prefix.

After the message, list only what the user can't do via the GUI: the `cd` to the right directory and the `git push` command. No `git add`, no `git commit` — those happen in the GUI.

Example format:

> **3.7 submodule** (`Malurth/NetHack`, branch `wasm-3.7`):
> ```
> feat: short description
>
> Longer body explaining the change.
> ```
> Push:
> ```bash
> cd c:/Users/malur/neth4ck-monorepo/packages/wasm-37/NetHack
> git push origin HEAD:wasm-3.7
> ```

### NetHack submodule push targets

The submodules use detached HEAD and push to version-specific remote branches. Both share the same remote (`Malurth/NetHack`) but push to different branches:

- **3.7**: `cd c:/Users/malur/neth4ck-monorepo/packages/wasm-37/NetHack && git push origin HEAD:wasm-3.7`
- **3.6.7**: `cd c:/Users/malur/neth4ck-monorepo/packages/wasm-367/NetHack && git push origin HEAD:wasm-3.6.7`

Always use `HEAD:<branch>` since HEAD is detached.

## Key Principle: Frontend vs API Layer

**When fixing or adding functionality, decide where the change belongs:**

- **`@neth4ck/api` (monorepo)** — Any logic that handles WASM implementation details, game state parsing, callback routing, input sequencing, or anything a generic NetHack frontend would need. If the frontend is doing something messy to work around WASM quirks, that work should be pushed down into the API layer.
- **`NethackNarrated` (this repo)** — UI rendering, AI/LLM integration, user interaction patterns, styling, and any feature specific to *this* frontend's identity (narration, analysis, visual design).

**Rule of thumb:** If another frontend would need the same logic, it belongs in `@neth4ck/api`.

**README maintenance:** When adding, removing, or changing public API surface in `@neth4ck/api` (new exports, changed method signatures, new events, new options), update the API README at `neth4ck-monorepo/packages/api/README.md` to reflect the change.

## Tech Stack

- **Svelte 5** with runes (`$state`, `$derived`, `$effect`) — no external state library
- **Vite 8** — dev server and build
- **TypeScript 5.9**
- **@neth4ck/api** — high-level NetHack WASM interface (event-driven)
- **@themaximalist/llm.js** — multi-provider LLM abstraction (Anthropic, OpenAI, Google, etc.)

## Project Structure

```
src/
├── components/       # Svelte UI components (MapDisplay, InventoryPanel, NarrationPanel, etc.)
├── services/         # wasm-connection.ts (WASM lifecycle + state bridging), llm-service.ts (AI prompts)
├── state/            # Svelte rune stores: game.svelte.ts, llm.svelte.ts, ui.svelte.ts, connection.svelte.ts
├── types/            # TypeScript type definitions
├── utils/            # Color mappings, item categories, keyboard mappings, narration heuristics, save slot management
├── App.svelte        # Root layout, keyboard handling, state wiring
└── main.ts           # Entry point
scripts/
└── copy-wasm.mjs     # Copies WASM assets from node_modules to public/ at build time
```

## Architecture

### Data Flow
```
User Input (keyboard/click)
  → wasm-connection.ts calls game.action() or game.handleKey()
  → API dispatches to WASM (action mapping, prompt routing, verb sequencing)
  → WASM executes game turn
  → API emits events (mapUpdate, message, inputRequired, statusChange, etc.)
  → API state getters provide map, visibleMonsters/Items/Features (with obscured flag), inventory (with displayText), status, etc.
  → wasm-connection.ts translates API state into frontend GameState
  → Svelte stores update reactively
  → Components re-render
  → llm-service.ts optionally generates narration
```

### Key Files

| File | Role |
|------|------|
| `src/services/wasm-connection.ts` | Thin adapter bridging `@neth4ck/api` to Svelte state stores; delegates action dispatch, input routing, and entity scanning to the API |
| `src/services/llm-service.ts` | Narration/analysis prompt engineering, LLM streaming, notable event detection |
| `src/state/game.svelte.ts` | Core game state: turn, map, player stats, messages, inventory, conditions |
| `src/state/llm.svelte.ts` | LLM config: provider, models, API keys, narration mode, output entries |
| `src/components/MapDisplay.svelte` | Dungeon map rendering with color, entity highlighting, click-to-move |
| `src/components/PromptBar.svelte` | Y/N prompts, menu selection, choice buttons |
| `src/components/InventoryPanel.svelte` | Items with BUC status, context-aware verb actions |
| `src/components/NarrationPanel.svelte` | Streaming narration/analysis display, mode toggle |
| `src/utils/keyboard.ts` | Keyboard event → action name mapping (vi-keys, special keys); action→keystroke mapping lives in `@neth4ck/api` |

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # Production build (copies WASM to public/ first)
npm run preview   # Preview production build
npm run check     # svelte-check + tsc
npm run test      # vitest run + svelte-check (full suite)
npx vitest run    # tests only (no type check)
npx vitest run -t "test name"  # run a single test by name
```

## Testing

**Every fix and feature must be tested.** Do not rely on reasoning alone — write tests that prove the code works, run them, and verify they pass before delivering. If a test cannot be written (e.g. pure visual styling), explain why.

### Test Infrastructure

| Layer | Environment | File pattern | What to test |
|-------|-------------|-------------|--------------|
| **Unit tests** | `node` | `*.test.ts` | Pure logic: utils, state stores, keyboard mappings |
| **Integration tests** | `node` + `fake-indexeddb` | `*.integration.test.ts` | Full WASM pipeline: boot game → dispatch actions → verify state. Save persistence via IndexedDB. |
| **Wizard-mode integration** | `node` + `fake-indexeddb` | `*.wizard.integration.test.ts` | Deterministic scenario tests using NetHack's wizard (debug) mode. Use `#wizwish` to spawn items, `#wizmap` to reveal levels, etc. |
| **Component tests** | `jsdom` | `*.component.test.ts` | DOM rendering: does a component show the right elements, respond to clicks, show/hide conditionally |

### Setup

- **Vitest** with environment-per-file: `node` by default, `jsdom` for `*.component.test.ts` (via `environmentMatchGlobs` in `vite.config.ts`)
- **`src/test-setup.ts`** — runs for all tests: polyfills `localStorage` and `indexedDB` (via `fake-indexeddb/auto`)
- **`@testing-library/svelte`** + `svelteTesting()` vite plugin — resolves Svelte to client build in tests, auto-cleans DOM between component tests
- **`@testing-library/jest-dom`** — `.toBeInTheDocument()`, `.toBeVisible()`, etc.

### Writing Tests

**Unit tests (`*.test.ts`):**
```ts
import { describe, it, expect } from 'vitest';
// Direct imports, no DOM needed
```

**Integration tests (`*.integration.test.ts`):**
```ts
import { NethackStateManager } from '@neth4ck/api';
// Boot real WASM, test full action→state pipeline
// IndexedDB available via fake-indexeddb polyfill
// WASM instances are heavy (~1.3GB) — minimize concurrent instances
// Use `{ timeout: 15000 }` for tests that boot multiple WASM instances
```

**Wizard-mode integration tests (`*.wizard.integration.test.ts`):**
```ts
import { NethackStateManager } from '@neth4ck/api';
// Boot with playmode:debug to enable wizard commands:
//   options: ["playmode:debug", "color", "number_pad:0", ...]
// Then use wizard commands to set up deterministic scenarios:
//   game.action("wizwish");   // → line prompt → game.answerLine("large box")
//   game.action("wizmap");    // reveal entire dungeon level
//   game.action("wizidentify"); // identify all inventory items
//   game.action("wizdetect"); // detect hidden things, traps, secret doors
//   game.action("wizgenesis"); // spawn a specific monster
//   game.action("wizlevelchange"); // teleport to a different level (3.7)
//   game.action("wizlevelport");   // teleport to a different level (3.6.7)
// Prefer wizard-mode tests for anything that depends on specific game state
// (items, monsters, map features) rather than hoping RNG cooperates.
// See wasm-connection.wizard.integration.test.ts for helper functions.
```

**Component tests (`*.component.test.ts`):**
```ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import MyComponent from './MyComponent.svelte';
// Use createFakeIDB() helper if the component checks IndexedDB
// Use screen.findByText() (async) for content that appears after async operations
```

### Key Patterns

- **Wizard mode for deterministic tests**: Both WASM builds have `WIZARDS=*` in sysconf, so `playmode:debug` works for any user. Use wizard commands (`wizwish`, `wizmap`, `wizgenesis`, etc.) to set up specific scenarios instead of relying on RNG. The wizard extended commands are registered in `@neth4ck/api` `EXTENDED_COMMANDS` and dispatched via `game.action("wizwish")` etc.
- **WASM save tests** need `fake-indexeddb` (auto-loaded) and `bootWithSaves()` helper
- **Component tests with save slots** need both `saveSlotRegistry()` AND `createFakeIDB()` — the registry is in localStorage but `validateSlots()` checks IndexedDB
- **Test timeouts**: WASM boot is slow. Use `{ timeout: 15000 }` for tests creating multiple WASM instances
- **Svelte runes** (`$state`, `$derived`) work in both node and jsdom because the Svelte compiler transforms them at build time

## AI Integration

- **Narration modes:** On (every turn), Partial (notable events only), Off
- **Analysis:** On-demand gameplay advice via extended thinking
- **Notable events:** Level changes, HP drops, status conditions, combat, discoveries, shops
- **Providers:** Anthropic (default), OpenAI, Google, Groq, xAI, DeepSeek, Ollama
- **Config:** API keys and model selection stored in localStorage

## Conventions

- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` or stores
- Dark theme with accent color `#00ff88`, monospace throughout
- Components communicate via shared state stores, not props drilling
- WASM connection is a singleton module, not a component
