# API-Layer Refactor Roadmap

Push implementation details out of NethackNarrated and into `@neth4ck/api` so the frontend only interacts with a clean, high-level interface.

## Tasks

- [x] **1. visibleItems/visibleFeatures getters** — Eliminate ~80-line map scan from frontend; API now exposes items and features directly alongside visibleMonsters. Includes `obscured` flag for items/features hidden under other entities. Features beneath monsters are detected via dungeon terrain scan (`get_levl_typ` + `get_stair_direction` + `get_feature_color` WASM exports), so even the staircase at spawn is reported with correct name, direction, and display color.

- [x] **2. Unified input handler** — `handleKey(key)` routes by prompt type (yn → answerYn, menu → selectMenuItem/dismissMenu, etc.). Extended commands in `action()` now use `sendExtCmd()` with proper index lookup via `_lookupExtCmdIndex()` instead of broken key-by-key loop.

- [x] **3. Action dispatcher** — Add `action("eat:d")`, `extendedCommand("pray")`, etc. to API so the frontend doesn't maintain its own action→key mappings and extended command sets.

- [x] **4. Inventory display text** — Export `_doname` from WASM, call it in `refreshInventory()` to populate `displayText` with NetHack's canonical item descriptions.

- [x] **5. quit() method** — Add `quit()` to API that auto-confirms "Really quit?" and DYWYPI prompts. Also available as `action("quit")` for manual control. Uses `get_extcmd_index` WASM export to resolve the quit command index.

- [x] **6. Game knowledge constants** — OBJ_CLASS_NAMES, FEATURE_NAMES, ITEM_CATEGORY_BY_CHAR, TERRAIN_TYPE_NAMES/CHARS all exported from API. Frontend imports OBJ_CLASS_NAMES; the rest are used internally by the callbackRouter. No duplication in the frontend.

- [x] **7. Fix WASM internals leaking** — API now clears `shimFunctionRunning` in `start()` before `_main()`, and refreshes inventory on both `inputRequired` and `mapUpdate` events. Frontend no longer touches `nethackGlobal` or calls `refreshInventory()` manually.

- [x] **8. dlvl as a status field** — API now parses `dlvl` (number) from `levelDesc` on every status update. Frontend reads `status.dlvl` directly instead of regex parsing.

- [x] **9. General NETHACKOPTIONS support** — `nethackOptions.options` accepts an array of arbitrary NETHACKOPTIONS strings (e.g. `["color", "showexp", "number_pad:0"]`). Frontend no longer needs a `preRun` hook to set game options.
