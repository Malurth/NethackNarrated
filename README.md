# NethackNarrated

Play NetHack in the browser with AI-powered narration and gameplay analysis.

**Play now: https://malurth.github.io/NethackNarrated/**

## About

NethackNarrated is a browser-based NetHack frontend that pairs the classic roguelike with an AI narrator. As you explore the dungeon, an LLM watches your game and generates dramatic narration, color commentary, or strategic advice in real time.

Supports both **NetHack 3.7** and **3.6.7**, running entirely client-side via WebAssembly — no server required.

## Features

- **AI Narration** — An LLM narrates your adventure as you play, reacting to combat, discoveries, deaths, and more
- **Analysis Mode** — On-demand gameplay advice using extended thinking, for when you need strategic guidance
- **Multiple LLM Providers** — Anthropic, OpenAI, Google, Groq, xAI, DeepSeek, and Ollama (local)
- **Full NetHack Gameplay** — Keyboard-driven with vi-keys, click-to-move on the map, inventory management, and all extended commands
- **Dual Version Support** — Switch between NetHack 3.7 and 3.6.7
- **Save System** — Multiple save slots with persistent storage via IndexedDB
- **Color Map Display** — Syntax-highlighted dungeon map with entity legend showing visible monsters, items, and features
- **Context-Aware Inventory** — Items with BUC status, verb actions (eat, wear, wield, read, etc.)
- **Smart Prompts** — Y/N prompts, menu selection, direction chooser, and line input all handled in-UI

## Setup

The game itself requires no setup — just open the link and play.

To enable AI narration, open Settings and enter an API key for your preferred LLM provider. Your keys are stored locally in your browser and never sent to any server other than the LLM provider itself.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`

## Tech Stack

- **Svelte 5** with runes
- **Vite** — dev server and build
- **TypeScript**
- **@neth4ck/api** — NetHack WASM interface ([neth4ck-monorepo](https://github.com/Malurth/neth4ck-monorepo))
- **Vercel AI SDK** — multi-provider LLM streaming

## Credits

- [NetHack](https://nethack.org/) by the NetHack DevTeam
- WASM port based on [apowers313/neth4ck-monorepo](https://github.com/apowers313/neth4ck-monorepo)
