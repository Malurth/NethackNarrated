# Plan: Hybrid Directional Action System

## Problem

Two-step directional actions (kick, loot, open, close, untrap, etc.) lose context across the two steps:

1. `action("kick")` emits `actionTaken({action: "kick"})`, game asks "In what direction?" (yn prompt)
2. User answers with direction — but no combined `actionTaken({action: "kick", direction: "w"})` is ever emitted
3. Frontend/narration has no idea the direction was for kicking

Additionally, `action("move_w")` during a yn prompt previously crashed with "wrong input type: expected [key, poskey], got yn". That's now fixed, but the action tracking is still broken.

## Design: Pending Action Tracker + Compound Syntax

### Core Components (all in `stateManager.js`)

| Component | Purpose |
|---|---|
| `_pendingDirectionalAction` | Instance field: stores the last dispatched action info (set by `_emitAction`) |
| `_isDirectionPrompt()` | Helper method: returns true if current yn prompt is a direction prompt. Checks `inputState === 3` (3.7 getdirInp) with regex fallback `/direction/i` on query text (3.6.7) |
| Compound syntax | `action("kick:w")` parses direction suffix, dispatches command + auto-answers direction prompt via interceptor |
| `_dispatchDirectionalAction()` | New method: sends command key/extcmd, installs interceptor to catch and auto-answer the direction yn prompt |

### constants.js change

Add `self: "."` to `DIRECTIONS` for self-targeting (kick down, loot here).

### Three Paths, One Result

All produce combined `actionTaken({action: "kick", direction: "w"})`:

**Path A — Compound syntax: `action("kick:w")`**
1. `action()` parses "kick:w", recognizes "w" as direction in DIRECTIONS
2. Emits combined `actionTaken({action: "kick", direction: "w"})` immediately
3. Calls `_dispatchDirectionalAction("kick", "w")` which sends the command key, installs interceptor that auto-answers the direction yn prompt

**Path B — Two-step keyboard: `action("kick")` then `action("move_w")`**
1. `action("kick")` dispatches normally, emits `actionTaken({action: "kick"})`, sets `_pendingDirectionalAction = {action: "kick"}`
2. Game asks "In what direction?" -> yn prompt -> `inputRequired` fires
3. `action("move_w")` enters yn handler, sees `_isDirectionPrompt()` && pending is set
4. Emits `actionTaken({action: "kick", direction: "w"})`, clears pending, calls `answerYn("h")`

**Path C — Two-step click: `action("kick")` then `handleClick(x, y)`**
1. Same as B steps 1-2
2. `handleClick` computes direction from click delta, same merge logic

### Modified code paths

**`action()` — yn handler (existing):**
- When `_isDirectionPrompt() && _pendingDirectionalAction` is set, emit combined event before calling `answerYn`
- When NOT a direction prompt, pass through to existing single-key yn handling (no merge)

**`action()` — compound syntax (new, before existing verb:letter check):**
- Parse `name:suffix`, check if suffix is a valid direction
- If yes: emit combined actionTaken, call `_dispatchDirectionalAction(base, suffix)`

**`handleKey()` — yn branch:**
- Same direction-prompt merge check: if pending + isDirectionPrompt, reverse-lookup the key to a direction name, emit combined, call `answerYn`
- Otherwise emit generic `{action: "answer", ...}` as before

**`handleClick()` — yn branch (new):**
- When yn prompt is active, compute direction from click, apply same merge logic
- Non-direction yn prompts: ignore click (return early)

**`_emitAction()` — set pending tracker:**
- For non-trivial actions (not "answer", "move", "key"), set `_pendingDirectionalAction = info`
- Clears stale state naturally since each new action overwrites

### Edge Cases

- **Non-direction yn prompts** ("Really attack?"): `_isDirectionPrompt()` returns false, no merge, existing behavior preserved
- **ESC during direction prompt**: pending cleared on next `_emitAction` call
- **Self-direction**: `action("kick:self")` sends "." via DIRECTIONS
- **3.6.7 compat**: regex fallback when inputState isn't available
- **Interceptor conflicts**: `_dispatchDirectionalAction` throws if interceptor already active (same as existing `_sendVerbThenItem`)

### Frontend change (small)

**`llm-service.ts` — `describeAction()`**: handle `direction` field on any action type so narration renders "kicked north" etc.

### Testing

Integration tests in `wasm-connection.integration.test.ts`:
- `action("kick")` + `action("move_n")` during yn -> valid state, combined actionTaken
- `action("kick:n")` compound syntax -> valid state, combined actionTaken
- `handleClick` during direction prompt -> valid state
- `action("loot")` + direction -> works for extended commands too
- Non-direction yn ("Really attack?") does NOT merge
