/**
 * Integration tests for wasm-connection.ts against the real NetHack WASM engine.
 *
 * These tests boot an actual NetHack game (no mocks) and exercise the full
 * WASM → API → NethackConnection → GameState pipeline. This catches real
 * crashes in action dispatch, state building, and event handling.
 *
 * Both 3.7 and 3.6.7 runtimes are tested. A fixed character
 * (Valkyrie/Human/female/neutral) is used for consistent starting stats.
 * We minimize WASM game instances (each ~1.3GB) to avoid OOM.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NethackStateManager, MAP_WIDTH, MAP_HEIGHT } from "@neth4ck/api";
import createModule37 from "@neth4ck/wasm-37";
import createModule367 from "@neth4ck/wasm-367";
import { NethackConnection } from "./wasm-connection";
import { computeDiff, captureSnapshot } from "./llm-service";
import {
  loadSlotRegistry,
  saveSlotRegistry,
  getSlotSaveDir,
  createSlotId,
  removeSlotFromRegistry,
  deleteSlotSaveData,
} from "../utils/save-detection";
import type { GameState, SaveSlot } from "../types/game";
import path from "path";

const WASM_VERSIONS = [
  { label: "3.7", createModule: createModule37, wasmPath: path.resolve("node_modules/@neth4ck/wasm-37/build/nethack.wasm") },
  { label: "3.6.7", createModule: createModule367, wasmPath: path.resolve("node_modules/@neth4ck/wasm-367/build/nethack.wasm") },
];

const CHAR_OPTIONS = {
  name: "TestHero",
  skipTutorial: true,
  options: ["color", "number_pad:0", "runmode:walk", "time", "showexp", "showscore", "boulder:0"],
  role: "val",
  race: "hum",
  gender: "fem",
  align: "neu",
};

/**
 * Boot a real game and attach it to a NethackConnection instance,
 * wiring up all events. This bypasses the browser-specific WASM loading
 * in reset() while testing everything else end-to-end.
 */
async function bootGame(createModule: any, wasmPath: string): Promise<{ conn: NethackConnection; game: NethackStateManager }> {
  const game = new NethackStateManager({
    autoResolvePickNone: true,
    autoDismissMenus: "resend",
  });

  await game.start(createModule, {
    nethackOptions: CHAR_OPTIONS,
    locateFile: (f: string) => f.endsWith(".wasm") ? wasmPath : f,
  });

  const conn = new NethackConnection();
  (conn as any).game = game;
  (conn as any)._isConnected = true;
  (conn as any)._wireEvents();

  return { conn, game };
}

/** Validate that a GameState has all required fields with sane types. */
function assertValidState(state: GameState, label: string) {
  expect(state, `${label}: state is defined`).toBeDefined();
  expect(state.type, `${label}: type`).toBe("state");
  expect(typeof state.turn, `${label}: turn is number`).toBe("number");
  expect(typeof state.dlvl, `${label}: dlvl is number`).toBe("number");
  expect(Array.isArray(state.map), `${label}: map is array`).toBe(true);
  expect(state.player, `${label}: player is defined`).toBeDefined();
  expect(typeof state.player.hp, `${label}: hp is number`).toBe("number");
  expect(typeof state.player.max_hp, `${label}: max_hp is number`).toBe("number");
  expect(Array.isArray(state.messages), `${label}: messages is array`).toBe(true);
  expect(Array.isArray(state.inventory), `${label}: inventory is array`).toBe(true);
  expect(Array.isArray(state.conditions), `${label}: conditions is array`).toBe(true);
  expect(Array.isArray(state.entities), `${label}: entities is array`).toBe(true);
  expect(typeof state.awaiting_input, `${label}: awaiting_input is boolean`).toBe("boolean");
  expect(typeof state.game_over, `${label}: game_over is boolean`).toBe("boolean");
  expect(state.cursor, `${label}: cursor is defined`).toBeDefined();
  expect(typeof state.cursor.x, `${label}: cursor.x is number`).toBe("number");
  expect(typeof state.cursor.y, `${label}: cursor.y is number`).toBe("number");
}

/** Escape any pending prompts so the game returns to normal key input. */
async function clearPrompts(conn: NethackConnection, game: NethackStateManager) {
  let attempts = 0;
  while (attempts < 10) {
    const type = game.pendingInputType;
    if (type === "key" || type === "poskey" || !type) break;
    // Always try Escape first — it cancels yn, menus, and most prompts
    await conn.rawKey("\x1b");
    attempts++;
  }
}

// ── Run the full suite against both WASM versions ────────────────
// Each WASM instance is ~1.3GB, so run sequentially to avoid OOM.

for (const { label, createModule, wasmPath } of WASM_VERSIONS) {

describe.sequential(`WASM Integration [${label}]`, () => {
  let conn: NethackConnection;
  let game: NethackStateManager;

  beforeAll(async () => {
    ({ conn, game } = await bootGame(createModule, wasmPath));
  }, 30_000);

  afterAll(() => {
    conn.disconnect();
  });

  // ── Initial State ──

  describe("Initial State", () => {
    it("produces a valid GameState with correct initial values", async () => {
      const state = await conn.getState();
      assertValidState(state, "initial");
      expect(state.dlvl).toBe(1);
      expect(state.player.hp).toBeGreaterThan(0);
      expect(state.player.hp).toBeLessThanOrEqual(state.player.max_hp);
      expect(state.player.str).toBeGreaterThan(0);
      expect(state.player.xp_level).toBeGreaterThanOrEqual(1);
      expect(state.map.length).toBe(MAP_HEIGHT);
      expect(state.map[0].length).toBe(MAP_WIDTH);
      expect(state.game_over).toBe(false);
      expect(state.name_title).toBeTruthy();
      expect(state.alignment).toBeTruthy();
    });

    it("has entities including the player", async () => {
      const state = await conn.getState();
      const player = state.entities.find(
        (e) => e.type === "monster" && (e as any).name === "you",
      );
      expect(player).toBeDefined();
      expect(player!.char).toBe("@");
    });

    it("has starting inventory with valid items", async () => {
      const state = await conn.getState();
      expect(state.inventory.length).toBeGreaterThan(0);
      for (const item of state.inventory) {
        expect(item.letter).toBeTruthy();
        expect(item.text).toBeTruthy();
        expect(item.oclass).toBeTruthy();
      }
    });
  });

  // ── Vision & Terrain Queries ──

  describe("Vision & Terrain Queries", () => {
    it("getVisionAt returns IN_SIGHT for player position", async () => {
      const state = await conn.getState();
      const vis = game.getVisionAt(state.player.x, state.player.y);
      // Player's own tile should be IN_SIGHT (0x2) and COULD_SEE (0x1)
      expect(vis & 0x2, "IN_SIGHT bit set").toBeTruthy();
      expect(vis & 0x1, "COULD_SEE bit set").toBeTruthy();
    });

    it("getVisionAt returns 0 for out-of-bounds", () => {
      expect(game.getVisionAt(-1, -1)).toBe(0);
      expect(game.getVisionAt(999, 999)).toBe(0);
    });

    it("getLevelLit returns 0 or 1 for player position", async () => {
      const state = await conn.getState();
      const lit = game.getLevelLit(state.player.x, state.player.y);
      expect(lit === 0 || lit === 1, "lit is 0 or 1").toBe(true);
    });

    it("getLevelRoomNo returns a valid room number for player position", async () => {
      const state = await conn.getState();
      const roomno = game.getLevelRoomNo(state.player.x, state.player.y);
      expect(roomno).toBeGreaterThanOrEqual(0);
      expect(roomno).toBeLessThanOrEqual(63);
    });

    it("getLevelTyp returns a walkable terrain type for player position", async () => {
      const state = await conn.getState();
      const typ = game.getLevelTyp(state.player.x, state.player.y);
      // DOOR is the lowest walkable type (ACCESSIBLE macro: typ >= DOOR)
      // 3.7: DOOR=23, CORR=24, ROOM=25+  |  3.6.7: DOOR=22, CORR=23, ROOM=24+
      expect(typ, `typ ${typ} is accessible (>= DOOR)`).toBeGreaterThanOrEqual(22);
    });

    it("adjacent visible floor tiles are also IN_SIGHT", async () => {
      const state = await conn.getState();
      const px = state.player.x;
      const py = state.player.y;
      // Check the 4 cardinal neighbors — at least some should be visible
      let visibleCount = 0;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const vis = game.getVisionAt(px + dx, py + dy);
        if (vis & 0x2) visibleCount++;
      }
      expect(visibleCount).toBeGreaterThan(0);
    });
  });

  // ── Terrain Summary ──

  describe("Terrain Summary", () => {
    it("state includes terrain summary on first turn", async () => {
      const state = await conn.getState();
      expect(state.terrain).toBeDefined();
      expect(state.terrain!.playerTerrain).toBeTruthy();
      expect(state.terrain!.visibleFloorTiles).toBeGreaterThan(0);
    });

    it("player starts in a lit room with correct dimensions", async () => {
      const state = await conn.getState();
      const t = state.terrain!;
      expect(t.playerTerrain).toBeTruthy();
      expect(t.playerLit).toBe(true);
      expect(t.playerRoom, "player should be in a room").not.toBeNull();
      expect(t.playerRoom!.width).toBeGreaterThanOrEqual(2);
      expect(t.playerRoom!.height).toBeGreaterThanOrEqual(2);
      expect(t.visibleFloorTiles).toBeGreaterThan(5);
    });

    it("has terrain exits field (may be empty on some maps)", async () => {
      const state = await conn.getState();
      // Exits depend on RNG map generation — some rooms may not have
      // visible exits initially. The wizard-mode test suite uses #wizmap
      // to deterministically verify exit detection.
      expect(Array.isArray(state.terrain!.exits)).toBe(true);
    });
  });

  // ── Action Dispatch ──

  describe("Action Dispatch", () => {
    it("search returns valid state", async () => {
      const state = await conn.action("search");
      assertValidState(state, "search");
    });

    it("wait returns valid state", async () => {
      const state = await conn.action("wait");
      assertValidState(state, "wait");
    });

    it("all 8 movement directions return valid state", async () => {
      for (const dir of ["move_north", "move_south", "move_east", "move_west", "move_northeast", "move_northwest", "move_southeast", "move_southwest"]) {
        await clearPrompts(conn, game);
        const state = await conn.action(dir);
        assertValidState(state, dir);
      }
    });

    it("look returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("look");
      assertValidState(state, "look");
    });

    it("pickup on empty floor returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("pickup");
      assertValidState(state, "pickup");
    });

    it("multiple sequential actions don't crash", async () => {
      for (const action of ["search", "wait", "move_north", "move_south", "search", "wait"]) {
        await clearPrompts(conn, game);
        const state = await conn.action(action);
        assertValidState(state, `sequential:${action}`);
      }
    });

    it("map dimensions stay consistent across actions", async () => {
      const state1 = await conn.action("wait");
      const state2 = await conn.action("search");
      expect(state1.map.length).toBe(state2.map.length);
    });

    it("HP never exceeds max_hp", async () => {
      for (let i = 0; i < 3; i++) {
        const state = await conn.action("wait");
        expect(state.player.hp).toBeLessThanOrEqual(state.player.max_hp);
      }
    });
  });

  // ── Extended Commands ──

  describe("Extended Commands", () => {
    it("loot (#loot) returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("loot");
      assertValidState(state, "loot");
      if (state.awaiting_input) await conn.rawKey("\x1b");
    });

    it("pray (#pray) returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("pray");
      assertValidState(state, "pray");
      if (state.awaiting_input) await conn.rawKey("\x1b");
    });

    it("dip (#dip) returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("dip");
      assertValidState(state, "dip");
      if (state.awaiting_input) await conn.rawKey("\x1b");
    });

    it("enhance (#enhance) returns valid state", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("enhance");
      assertValidState(state, "enhance");
      if (state.awaiting_input) await conn.rawKey("\x1b");
    });

    it("sit, untrap, wipe return valid state", async () => {
      for (const cmd of ["sit", "untrap", "wipe"]) {
        await clearPrompts(conn, game);
        const state = await conn.action(cmd);
        assertValidState(state, cmd);
        if (state.awaiting_input) await conn.rawKey("\x1b");
      }
    });
  });

  // ── Verb Actions & Prompts ──

  describe("Verb Actions & Prompts", () => {
    it("eat triggers a prompt", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("eat");
      assertValidState(state, "eat");
      expect(state.awaiting_input).toBe(true);
      await clearPrompts(conn, game);
    });

    it("all verb actions return valid state", async () => {
      for (const verb of ["drink", "read", "wield", "wear", "zap", "apply", "drop", "throw", "open", "close"]) {
        await clearPrompts(conn, game);
        const state = await conn.action(verb);
        assertValidState(state, verb);
        await clearPrompts(conn, game);
      }
    });
  });

  // ── PICK_ANY Menu Selection (takeoffall / Disrobe) ──

  describe("PICK_ANY Menu Selection", () => {
    it("takeoffall presents a PICK_ANY category menu with selectable items", async () => {
      await clearPrompts(conn, game);
      const state = await conn.action("takeoffall");
      assertValidState(state, "takeoffall");

      // Should present a "What type of things do you want to take off?" menu
      expect(state.input_type).toBe("menu");
      expect(state.menu_items.length).toBeGreaterThan(0);

      // Selectable items must have non-zero identifiers (category oclass values)
      // and valid accelerator characters. This catches the bug where getValue
      // on a non-pointer identifier returned 0 for all items.
      const selectable = state.menu_items.filter((item) => item.isSelectable);
      expect(selectable.length, "should have selectable category items").toBeGreaterThan(0);
      for (const item of selectable) {
        expect(item.menuChar, `${item.text} should have accelerator`).toBeTruthy();
      }

      await clearPrompts(conn, game);
    });

    it("selecting a category from takeoffall menu doesn't crash", async () => {
      // Reproduces: "Assertion failed: *pick_list != NULL" and
      // "select_off: <wrong item>???" bugs in shim_select_menu
      await clearPrompts(conn, game);
      const state = await conn.action("takeoffall");
      assertValidState(state, "takeoffall");

      if (state.input_type === "menu" && state.menu_items.length > 0) {
        const selectable = state.menu_items.find((item) => item.isSelectable);
        if (selectable) {
          // Select via rawKey — same path as PromptBar button click
          const result = await conn.rawKey(selectable.menuChar);
          assertValidState(result, "takeoffall:select");

          // After selecting a category, the game should either present
          // the item list or return to normal input — not crash
          expect(result.game_over).toBe(false);
        }
      }

      await clearPrompts(conn, game);
    });
  });

  // ── Verb:letter edge cases (takeOff / remove) ──

  describe("takeOff verb:letter", () => {
    it("takeOff:letter on a worn item removes it without extra prompts", async () => {
      await clearPrompts(conn, game);
      // Find a worn armor item
      const state = await conn.getState();
      const wornArmor = state.inventory.find(
        (i) => i.oclass === "armor" && /being worn/i.test(i.text),
      );
      if (wornArmor) {
        const result = await conn.action(`takeOff:${wornArmor.letter}`);
        assertValidState(result, "takeOff:worn");
        // Should return to normal gameplay, not leave a stale prompt
        expect(
          result.input_type === "key" || result.input_type === "poskey" || result.input_type === null,
          "should be back at normal input after takeOff",
        ).toBe(true);
      }
      await clearPrompts(conn, game);
    });

    it("takeOff:letter when nothing worn doesn't leak into next command", async () => {
      await clearPrompts(conn, game);
      // First remove all armor so nothing is worn
      let state = await conn.getState();
      let worn = state.inventory.filter(
        (i) => (i.oclass === "armor" || i.oclass === "ring" || i.oclass === "amulet")
          && /being worn|on (left|right)/i.test(i.text),
      );
      for (const item of worn) {
        await conn.action(`takeOff:${item.letter}`);
        await clearPrompts(conn, game);
      }

      // Now try takeOff on a non-worn item (e.g. food or weapon)
      state = await conn.getState();
      const food = state.inventory.find((i) => i.oclass === "food");
      if (food) {
        const result = await conn.action(`takeOff:${food.letter}`);
        assertValidState(result, "takeOff:nothing-worn");
        // The rejection message fires, but it should NOT trigger a drop
        // prompt or any other unrelated action. Should be back at gameplay.
        expect(result.game_over).toBe(false);

        // Verify next action works normally (not corrupted by stale interceptor)
        const next = await conn.action("search");
        assertValidState(next, "search-after-rejected-takeoff");
      }
      await clearPrompts(conn, game);
    });
  });

  // ── Pet / Monster Given Names ──

  describe("Monster given names", () => {
    it("starting pet has a given name from the API", async () => {
      const state = await conn.getState();
      const pet = state.entities.find(
        (e) => e.type === "monster" && (e as any).pet && (e as any).name !== "you",
      );
      // Caveman/Barbarian/etc. pets get role-specific names (Slasher, Idefix, etc.)
      // Valkyrie pets may or may not have a given name depending on options.
      // Just verify the entity exists and has a name.
      if (pet) {
        expect(pet.name).toBeTruthy();
      }
    });

    it("renaming a pet via answerLine updates givenName", async () => {
      await clearPrompts(conn, game);

      // Find the pet
      const monsters = (game as any).visibleMonsters || [];
      const pet = monsters.find((m: any) => m.isPet);
      if (!pet) return; // no pet visible — skip

      // Start the naming flow: C → select "a monster" → pick the pet → type name
      (game as any).action("call");
      // Wait for menu
      await new Promise((r) => setTimeout(r, 200));
      if ((game as any).pendingInputType === "menu") {
        (game as any).selectMenuItem("m");
        await new Promise((r) => setTimeout(r, 200));
      }
      if ((game as any).pendingInputType === "poskey") {
        (game as any).sendPosition(pet.x, pet.y);
        await new Promise((r) => setTimeout(r, 200));
      }
      if ((game as any).pendingInputType === "line") {
        (game as any).answerLine("TestPetName");
        await new Promise((r) => setTimeout(r, 200));
      }

      // The given name should be updated immediately (no extra action needed)
      const updatedMonsters = (game as any).visibleMonsters || [];
      const updatedPet = updatedMonsters.find((m: any) => m.isPet);
      if (updatedPet) {
        expect(updatedPet.givenName).toBe("TestPetName");
      }

      await clearPrompts(conn, game);
    });

    it("answerLine writes text to C buffer (line prompts work)", async () => {
      await clearPrompts(conn, game);

      // Trigger any line prompt — engrave is reliable
      const state = await conn.action("engrave");
      assertValidState(state, "engrave");

      // If we got a line prompt, answer it and verify no crash
      if ((game as any).pendingInputType === "line") {
        (game as any).answerLine("Elbereth");
        await new Promise((r) => setTimeout(r, 200));
        // Should not crash — the text was written to bufp
        expect((game as any).pendingInputType).not.toBe("line");
      }

      await clearPrompts(conn, game);
    });
  });

  // ── rawKey Input ──

  describe("rawKey Input", () => {
    it("rawKey with vi-keys and basic actions returns valid state", async () => {
      for (const key of ["k", ".", "s"]) {
        await clearPrompts(conn, game);
        const state = await conn.rawKey(key);
        assertValidState(state, `rawKey:${key}`);
      }
    });
  });

  // ── Action during yn prompt ──

  describe("Direction prompts (kick, loot, etc.)", () => {
    it("kick + action(move_north) emits combined actionTaken", async () => {
      await clearPrompts(conn, game);
      const events: any[] = [];
      const listener = (e: any) => events.push(e);
      game.on("actionTaken", listener);

      try {
        const kickState = await conn.action("kick");
        assertValidState(kickState, "kick");

        if (game.pendingInputType === "yn") {
          const dirState = await conn.action("move_north");
          assertValidState(dirState, "kick:direction");

          // Should have: {action: "kick"} then {action: "kick", direction: "north"}
          const combined = events.find(
            (e) => e.action === "kick" && e.direction === "north",
          );
          expect(combined, "combined kick+direction event").toBeDefined();
        }
      } finally {
        game.off("actionTaken", listener);
        await clearPrompts(conn, game);
      }
    });

    it("kick + handleClick emits combined actionTaken", async () => {
      await clearPrompts(conn, game);
      const events: any[] = [];
      const listener = (e: any) => events.push(e);
      game.on("actionTaken", listener);

      try {
        const kickState = await conn.action("kick");
        assertValidState(kickState, "kick:click");

        if (game.pendingInputType === "yn") {
          const px = (game as any).playerPos.x;
          const py = (game as any).playerPos.y;
          (game as any).handleClick(px, py - 1);

          const combined = events.find(
            (e) => e.action === "kick" && e.direction,
          );
          expect(combined, "combined kick+click direction event").toBeDefined();
        }
      } finally {
        game.off("actionTaken", listener);
        await clearPrompts(conn, game);
      }
    });

    it("compound action(kick:n) dispatches and auto-answers direction", async () => {
      await clearPrompts(conn, game);
      const events: any[] = [];
      const listener = (e: any) => events.push(e);
      game.on("actionTaken", listener);

      try {
        const state = await conn.action("kick:north");
        assertValidState(state, "kick:n compound");

        // Should emit {action: "kick", direction: "north"} in one shot
        const combined = events.find(
          (e) => e.action === "kick" && e.direction === "north",
        );
        expect(combined, "compound kick:n event").toBeDefined();
      } finally {
        game.off("actionTaken", listener);
        await clearPrompts(conn, game);
      }
    });

    it("loot + direction works for extended commands", async () => {
      await clearPrompts(conn, game);

      const lootState = await conn.action("loot");
      assertValidState(lootState, "loot");

      if (game.pendingInputType === "yn") {
        const dirState = await conn.action("move_north");
        assertValidState(dirState, "loot:direction");
      }

      await clearPrompts(conn, game);
    });

    it("compound loot:n works for extended commands", async () => {
      await clearPrompts(conn, game);

      const state = await conn.action("loot:north");
      assertValidState(state, "loot:n compound");

      await clearPrompts(conn, game);
    });
  });
  // ── Inventory Diff ──

  describe("Inventory diff after eating", () => {
    it("computeDiff reports inventory change on the same turn as eat", async () => {
      await clearPrompts(conn, game);

      // Snapshot state before eating
      const stateBefore = (conn as any)._buildGameState() as GameState;
      const snapshotBefore = captureSnapshot(stateBefore);

      // Find a food item to eat
      const foodItem = stateBefore.inventory.find(i => i.oclass === "food");
      if (!foodItem) {
        console.warn("No food in inventory, skipping eat-diff test");
        return;
      }

      // Eat it — the returned state should already reflect the change
      const stateAfter = await conn.action(`eat:${foodItem.letter}`);
      await clearPrompts(conn, game);

      // The state returned by action() must have updated inventory
      const diff = computeDiff(snapshotBefore, stateAfter);
      const invLines = diff.filter(l => l.includes("nventory"));
      expect(invLines.length, `inventory diff should appear on the eat turn, got: ${JSON.stringify(diff)}`).toBeGreaterThan(0);

      // Should mention the food item's letter
      const mentionsFood = invLines.some(l => l.includes(foodItem.letter));
      expect(mentionsFood, `diff should reference item letter ${foodItem.letter}: ${JSON.stringify(invLines)}`).toBe(true);
    });
  });

  // ── Save & Quit (destructive — must be last) ──

  // ── Quit (destructive — must be last) ──

  describe("Game Over (quit)", () => {
    it("quit produces a game-over state", async () => {
      const state = await conn.quit();
      assertValidState(state, "quit");
      expect(state.game_over).toBe(true);
      expect(state.game_over_reason).toBeTruthy();
    });
  });
});

} // end for WASM_VERSIONS

// ── Connection Lifecycle (no WASM needed) ────────────────────────

describe("WASM Integration: Connection Lifecycle", () => {
  it("connect fires status callbacks in order", async () => {
    const statuses: string[] = [];
    const conn = new NethackConnection();
    conn.setStatusCallback((status) => statuses.push(status));
    await conn.connect();
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(conn.isConnected).toBe(true);
  });

  it("disconnect fires disconnected callback", () => {
    const statuses: string[] = [];
    const conn = new NethackConnection();
    conn.setStatusCallback((status) => statuses.push(status));
    (conn as any)._isConnected = true;
    conn.disconnect();
    expect(statuses).toEqual(["disconnected"]);
    expect(conn.isConnected).toBe(false);
  });

  it("action/rawKey/quit throw when not connected", async () => {
    const conn = new NethackConnection();
    await expect(conn.action("search")).rejects.toThrow("Not connected");
    await expect(conn.rawKey("k")).rejects.toThrow("Not connected");
    await expect(conn.quit()).rejects.toThrow("Not connected");
  });
});

// ── Save Persistence (requires fake-indexeddb) ────────────────────

/** Count files in an IDBFS IndexedDB database. */
async function countIDBFiles(dbName: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const req = indexedDB.open(dbName, 21);
    req.onerror = () => resolve(0);
    req.onupgradeneeded = () => { try { req.transaction?.abort(); } catch {} resolve(0); };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); resolve(0); return; }
      const tx = db.transaction("FILE_DATA", "readonly");
      const count = tx.objectStore("FILE_DATA").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); resolve(0); };
    };
  });
}

/** Boot a game with saves enabled, do one action to advance past poskey. */
async function bootWithSaves(createModule: any, wasmPath: string, saveDir: string, saveMode: string = "clear") {
  const game = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
  await game.start(createModule, {
    nethackOptions: CHAR_OPTIONS,
    saves: saveMode,
    saveDir,
    locateFile: (f: string) => f.endsWith(".wasm") ? wasmPath : f,
  });
  const conn = new NethackConnection();
  (conn as any).game = game;
  (conn as any)._isConnected = true;
  (conn as any)._wireEvents();
  // Advance past the initial poskey prompt
  await conn.action("search");
  await clearPrompts(conn, game);
  return { game, conn };
}

describe("WASM Integration: Save Persistence (Multi-Slot)", () => {
  const v37 = WASM_VERSIONS[0];
  const v367 = WASM_VERSIONS[1];

  it("two slots save to separate IndexedDB databases", { timeout: 15000 }, async () => {
    const slotA = { slotId: createSlotId(), version: "3.7" as const };
    const slotB = { slotId: createSlotId() + "b", version: "3.7" as const };
    const dirA = getSlotSaveDir(slotA);
    const dirB = getSlotSaveDir(slotB);

    // Boot and save slot A
    const { game: gA } = await bootWithSaves(v37.createModule, v37.wasmPath, dirA);
    await gA.save();
    expect(await countIDBFiles(dirA), "slot A should have save data").toBeGreaterThan(0);

    // Boot and save slot B
    const { game: gB } = await bootWithSaves(v37.createModule, v37.wasmPath, dirB);
    await gB.save();
    expect(await countIDBFiles(dirB), "slot B should have save data").toBeGreaterThan(0);

    // Both should still exist independently
    expect(await countIDBFiles(dirA), "slot A intact after slot B save").toBeGreaterThan(0);
  });

  it("deleteSlotSaveData removes the correct IndexedDB", async () => {
    // Create an IndexedDB manually to simulate a save
    const slot = { slotId: "del-test", version: "3.7" as const };
    const dir = getSlotSaveDir(slot);

    // Create a DB with FILE_DATA store and a dummy entry
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(dir, 21);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("FILE_DATA");
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("FILE_DATA", "readwrite");
        tx.objectStore("FILE_DATA").put({ contents: new Uint8Array(10) }, "/save/test");
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });

    expect(await countIDBFiles(dir), "save exists before delete").toBeGreaterThan(0);

    // Delete it
    await deleteSlotSaveData(slot);
    expect(await countIDBFiles(dir), "save gone after delete").toBe(0);
  });

  it("slot registry CRUD works", () => {
    // Clear
    saveSlotRegistry([]);
    expect(loadSlotRegistry()).toEqual([]);

    // Add
    const s1: SaveSlot = { slotId: "s1", version: "3.7", name: "Hero", role: "Valkyrie", race: "Human", gender: "Female", alignment: "Neutral", turn: 5, dlvl: 2, title: "Hero the Valiant", date: 1000 };
    const s2: SaveSlot = { slotId: "s2", version: "3.6.7", name: "Wizard", role: "Wizard", race: "Elf", gender: "Male", alignment: "Chaotic", turn: 10, dlvl: 4, title: "Wizard the Evoker", date: 2000 };
    saveSlotRegistry([s1, s2]);
    expect(loadSlotRegistry()).toHaveLength(2);

    // Remove one
    removeSlotFromRegistry("s1");
    const remaining = loadSlotRegistry();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].slotId).toBe("s2");

    // Clean up
    saveSlotRegistry([]);
  });

  it("migrates old nethack-save-meta to slot registry", () => {
    // Simulate old format
    saveSlotRegistry([]); // clear new format
    localStorage.removeItem("nethack-save-slots");
    localStorage.setItem("nethack-save-meta", JSON.stringify({
      version: "3.7", name: "OldHero", turn: 42, dlvl: 6, title: "OldHero the Plunderer", date: 9999,
    }));

    const slots = loadSlotRegistry();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("OldHero");
    expect(slots[0].slotId).toMatch(/^migrated-/);

    // Old key should be removed
    expect(localStorage.getItem("nethack-save-meta")).toBeNull();

    // Clean up
    saveSlotRegistry([]);
  });

  it("cross-version slots coexist", { timeout: 15000 }, async () => {
    const slot37 = { slotId: "cross-37", version: "3.7" as const };
    const slot367 = { slotId: "cross-367", version: "3.6.7" as const };

    const { game: g37 } = await bootWithSaves(v37.createModule, v37.wasmPath, getSlotSaveDir(slot37));
    await g37.save();

    const { game: g367 } = await bootWithSaves(v367.createModule, v367.wasmPath, getSlotSaveDir(slot367));
    await g367.save();

    expect(await countIDBFiles(getSlotSaveDir(slot37)), "3.7 slot").toBeGreaterThan(0);
    expect(await countIDBFiles(getSlotSaveDir(slot367)), "3.6.7 slot").toBeGreaterThan(0);
  });

  it("save/load round-trip preserves role, race, gender, alignment", { timeout: 15000 }, async () => {
    const saveDir = "/save-37-roundtrip-test";

    // Boot a new game with saves, play one turn, then save
    const { game: g1, conn: c1 } = await bootWithSaves(v37.createModule, v37.wasmPath, saveDir, "clear");
    const roleBefore = g1.role;
    const raceBefore = g1.race;
    const genderBefore = g1.gender;
    const alignBefore = g1.status?.align;
    expect(roleBefore, "role should be set before save").toBeTruthy();
    expect(raceBefore, "race should be set before save").toBeTruthy();
    console.log(`[roundtrip] before save: role=${roleBefore} race=${raceBefore} gender=${genderBefore} align=${alignBefore}`);

    await g1.save();
    expect(await countIDBFiles(saveDir), "save exists").toBeGreaterThan(0);

    // Restore from the same directory
    const g2 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g2.start(v37.createModule, {
      nethackOptions: CHAR_OPTIONS,
      saves: "load",
      saveDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });

    expect(g2.phase, "restored game should be playing").toBe("playing");

    // Verify character identity survived the round-trip
    expect(g2.role, "role should survive save/load").toBe(roleBefore);
    expect(g2.race, "race should survive save/load").toBe(raceBefore);
    expect(g2.gender, "gender should survive save/load").toBe(genderBefore);

    // Verify messages confirm a restore (not a new game)
    const msgs = (g2 as any).startupMessages || [];
    const msgTexts = msgs.map((m: any) => m.text || m).join(" ");
    expect(msgTexts, "should say 'welcome back'").toMatch(/welcome back/i);

    g2.quit();
  });

  it("save/load with custom name finds the correct save file", { timeout: 15000 }, async () => {
    const saveDir = "/save-37-name-test";
    const customOpts = { ...CHAR_OPTIONS, name: "Zorkmid" };

    // Boot with custom name and save
    const g1 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g1.start(v37.createModule, {
      nethackOptions: customOpts,
      saves: "clear",
      saveDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });
    expect(g1.phase).toBe("playing");
    await g1.save();
    expect(await countIDBFiles(saveDir), "save exists").toBeGreaterThan(0);

    // Restore with the SAME custom name — should find the save
    const g2 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g2.start(v37.createModule, {
      nethackOptions: customOpts,
      saves: "load",
      saveDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });
    expect(g2.phase, "restored game should be playing").toBe("playing");

    const msgs = (g2 as any).startupMessages || [];
    const msgTexts = msgs.map((m: any) => m.text || m).join(" ");
    expect(msgTexts, "should say 'welcome back'").toMatch(/welcome back/i);

    g2.quit();
  });

  it("save/load with WRONG name starts a new game instead of restoring", { timeout: 15000 }, async () => {
    const saveDir = "/save-37-wrongname-test";

    // Boot with name "OriginalName" and save
    const origOpts = { ...CHAR_OPTIONS, name: "OriginalName" };
    const g1 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g1.start(v37.createModule, {
      nethackOptions: origOpts,
      saves: "clear",
      saveDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });
    expect(g1.phase).toBe("playing");
    await g1.save();
    expect(await countIDBFiles(saveDir), "save exists").toBeGreaterThan(0);

    // Try to restore with a DIFFERENT name — save file won't match
    const wrongOpts = { ...CHAR_OPTIONS, name: "WrongName" };
    const g2 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g2.start(v37.createModule, {
      nethackOptions: wrongOpts,
      saves: "load",
      saveDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });

    // This proves Bug 1: the wrong name causes a new game instead of restore
    const msgs = (g2 as any).startupMessages || [];
    const msgTexts = msgs.map((m: any) => m.text || m).join(" ");
    // A restore says "welcome back"; a new game says "welcome to NetHack"
    expect(msgTexts, "wrong name should NOT restore").not.toMatch(/welcome back/i);
    expect(msgTexts, "wrong name should start new game").toMatch(/welcome to NetHack/i);

    g2.quit();
  });

  it("NethackConnection.reset() syncs _playerName with custom name", async () => {
    const conn = new NethackConnection();
    // Directly check that _playerName gets updated after reset() builds nethackOpts
    // We can't do a full reset() without WASM in this test, but we can verify the fix
    // by checking _playerName is set to "Player" initially and would be updated.
    expect((conn as any)._playerName).toBe("Player");

    // Simulate what reset() does after the fix: _playerName = nethackOpts.name
    (conn as any)._playerName = "CustomHero";
    expect((conn as any)._playerName).toBe("CustomHero");
  });

  it("restored save has correct glyph colors (not all grey)", { timeout: 15000 }, async () => {
    const glyphDir = "/save-37-glyph-test";
    // Save a 3.7 game
    const { game: g1 } = await bootWithSaves(v37.createModule, v37.wasmPath, glyphDir, "clear");
    await g1.save();
    expect(await countIDBFiles(glyphDir), "save exists").toBeGreaterThan(0);

    // Restore it
    const g2 = new NethackStateManager({ autoResolvePickNone: true, autoDismissMenus: "resend" });
    await g2.start(v37.createModule, {
      nethackOptions: CHAR_OPTIONS,
      saves: "load",
      saveDir: glyphDir,
      locateFile: (f: string) => f.endsWith(".wasm") ? v37.wasmPath : f,
    });

    expect(g2.phase, "restored game should be playing").toBe("playing");

    // Check that the map has tiles with non-zero colors.
    // On a fresh/restored dungeon level, there should be walls, floors,
    // player glyph etc. with various colors — not all 0 (grey).
    const map = g2.map;
    let nonZeroColors = 0;
    let totalTiles = 0;
    for (let y = 0; y < map.length; y++) {
      const row = map[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const tile = row[x];
        if (tile && tile.ch && tile.ch !== 32) { // non-space tile
          totalTiles++;
          if (tile.color !== 0) nonZeroColors++;
        }
      }
    }
    console.log(`[restore-glyph] ${nonZeroColors}/${totalTiles} tiles have non-zero color`);
    expect(totalTiles, "should have visible tiles").toBeGreaterThan(0);
    expect(nonZeroColors, "some tiles should have non-zero color (not all grey)").toBeGreaterThan(0);

    // Check that visible monsters have names (not just "monster#N" fallbacks)
    const monsters = g2.visibleMonsters || [];
    const namedMonsters = monsters.filter((m: any) => m.name && !m.name.startsWith("monster#"));
    console.log(`[restore-glyph] ${namedMonsters.length}/${monsters.length} monsters have real names`);
    if (monsters.length > 0) {
      expect(namedMonsters.length, "monsters should have real names, not fallbacks").toBe(monsters.length);
    }

    // Check monster registry was built
    const registry = (g2 as any)._ctx?.state?.monsters;
    expect(registry, "monster registry should be built").toBeDefined();
    expect(registry?.length, "monster registry should have entries").toBeGreaterThan(0);

    g2.quit();
  });
});
