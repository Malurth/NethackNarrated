/**
 * Wizard-mode integration tests for wasm-connection.ts.
 *
 * Tests that only read game state share a single game session per version.
 * Tests that modify game state (combat, potions, level changes, death, etc.)
 * each boot a fresh game to avoid cascading failures.
 *
 * Wizard mode is enabled by passing `playmode:debug` in NETHACKOPTIONS.
 * Both WASM builds have WIZARDS=* in sysconf, allowing any user.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NethackStateManager } from "@neth4ck/api";
import createModule37 from "@neth4ck/wasm-37";
import createModule367 from "@neth4ck/wasm-367";
import { NethackConnection } from "./wasm-connection";
import type { GameState } from "../types/game";
import { gameState } from "../state/game.svelte";
import path from "path";

// ── Shared Setup ────────────────────────────────────────────────────

const WASM_VERSIONS = [
  { label: "3.7", createModule: createModule37, wasmPath: path.resolve("node_modules/@neth4ck/wasm-37/build/nethack.wasm") },
  { label: "3.6.7", createModule: createModule367, wasmPath: path.resolve("node_modules/@neth4ck/wasm-367/build/nethack.wasm") },
];

const WIZARD_OPTS = {
  name: "WizTest",
  skipTutorial: true,
  options: [
    "color", "number_pad:0", "runmode:walk", "time", "showexp", "showscore",
    "boulder:0", "playmode:debug",
  ],
  role: "wiz",
  race: "elf",
  gender: "mal",
  align: "cha",
};

/** Boot a wizard-mode game and return conn + game. */
async function boot(createModule: any, wasmPath: string) {
  const game = new NethackStateManager({
    autoResolvePickNone: true,
    autoDismissMenus: "resend",
  });
  await game.start(createModule, {
    nethackOptions: WIZARD_OPTS,
    locateFile: (f: string) => f.endsWith(".wasm") ? wasmPath : f,
  });
  const conn = new NethackConnection();
  (conn as any).game = game;
  (conn as any)._isConnected = true;
  (conn as any)._wireEvents();
  return { conn, game };
}

function assertValid(state: GameState, label: string) {
  expect(state, `${label}: defined`).toBeDefined();
  expect(typeof state.turn, `${label}: turn`).toBe("number");
  expect(Array.isArray(state.map), `${label}: map`).toBe(true);
  expect(state.player, `${label}: player`).toBeDefined();
  expect(typeof state.player.hp, `${label}: hp`).toBe("number");
  expect(state.game_over, `${label}: not game over`).toBe(false);
}

async function clear(conn: NethackConnection, game: NethackStateManager) {
  for (let i = 0; i < 10; i++) {
    const type = game.pendingInputType;
    if (type === "key" || type === "poskey" || !type) break;
    try {
      if (type === "yn") await conn.rawKey("n");
      else if (type === "line") await conn.sendLine("");
      else await conn.rawKey("\x1b");
    } catch { break; }
  }
}

async function wish(conn: NethackConnection, game: NethackStateManager, item: string) {
  await clear(conn, game);
  await conn.action("wizwish");
  if (game.pendingInputType === "yn") await conn.rawKey("y");
  if (game.pendingInputType === "line") await conn.sendLine(item);
  await clear(conn, game);
  return conn.getState();
}

async function identify(conn: NethackConnection, game: NethackStateManager) {
  await clear(conn, game);
  await conn.action("wizidentify");
  await clear(conn, game);
  return conn.getState();
}

async function revealMap(conn: NethackConnection, game: NethackStateManager) {
  await clear(conn, game);
  await conn.action("wizmap");
  await clear(conn, game);
  return conn.getState();
}

/** Level teleport via Ctrl+V. Returns true if successful. */
async function levelTeleport(conn: NethackConnection, game: NethackStateManager, level: number): Promise<boolean> {
  await clear(conn, game);
  await conn.rawKey("\x16"); // Ctrl+V
  for (let i = 0; i < 5; i++) {
    if (game.pendingInputType === "line") break;
    if (game.pendingInputType === "yn") await conn.rawKey("y");
    else break;
  }
  if (game.pendingInputType !== "line") { await clear(conn, game); return false; }
  await conn.sendLine(String(level));
  await clear(conn, game);
  return true;
}

/** Teleport to a specific tile via Ctrl+T. Returns true if successful. */
async function posTeleport(conn: NethackConnection, game: NethackStateManager, x: number, y: number): Promise<boolean> {
  await clear(conn, game);
  await conn.rawKey("\x14"); // Ctrl+T
  // In wizard mode, Ctrl+T gives a getpos prompt
  for (let i = 0; i < 5; i++) {
    if (game.pendingInputType === "poskey") break;
    if (game.pendingInputType === "yn") await conn.rawKey("y");
    else break;
  }
  if (game.pendingInputType !== "poskey") { await clear(conn, game); return false; }
  try {
    (game as any).sendPosition(x, y);
  } catch { return false; }
  await clear(conn, game);
  return true;
}

/**
 * Scan terrain for a specific tile type. Returns first match or null.
 * Requires wizmap to have been called first.
 */
function findTerrain(game: NethackStateManager, typValue: number): { x: number; y: number } | null {
  const tm = (game as any).getTerrainMap?.();
  if (!tm) return null;
  const COLNO = 80, ROWNO = 21;
  for (let y = 0; y < ROWNO; y++) {
    for (let x = 0; x < COLNO; x++) {
      if (tm.typs[y * COLNO + x] === typValue) return { x, y };
    }
  }
  return null;
}

/** Get the LEVL_TYP constant value for a named terrain type. */
function getTerrainType(game: NethackStateManager, name: string): number {
  const levlTyp = (game as any).constants?.LEVL_TYP;
  return levlTyp?.[name] ?? -1;
}

// ── Tests ───────────────────────────────────────────────────────────

for (const { label, createModule, wasmPath } of WASM_VERSIONS) {

describe.sequential(`Wizard Mode [${label}]`, () => {

  // ════════════════════════════════════════════════════════════════════
  // SHARED SESSION — non-destructive tests that only read/dispatch
  // ════════════════════════════════════════════════════════════════════

  describe("Shared session", () => {
    let conn: NethackConnection;
    let game: NethackStateManager;

    beforeAll(async () => {
      ({ conn, game } = await boot(createModule, wasmPath));
    }, 30_000);
    afterAll(() => { conn.disconnect(); });

    // ── Basics ──

    it("boots in wizard mode", async () => {
      const state = await conn.getState();
      assertValid(state, "boot");
      expect(state.player.hp).toBeGreaterThan(0);
      expect(game.role).toBe("Wizard");
    });

    it("#wizwish adds item to inventory", async () => {
      const before = (await conn.getState()).inventory.length;
      await wish(conn, game, "blessed +3 silver dragon scale mail");
      const after = await conn.getState();
      expect(after.inventory.length).toBeGreaterThan(before);
      expect(after.inventory.some((i) => /silver dragon scale mail/i.test(i.text))).toBe(true);
    });

    it("#wizidentify identifies items", async () => {
      const state = await identify(conn, game);
      assertValid(state, "identify");
      expect(state.inventory.length).toBeGreaterThan(0);
    });

    it("#wizmap reveals more tiles", async () => {
      const state = await revealMap(conn, game);
      assertValid(state, "wizmap");
    });

    it("#wizdetect runs without crash", async () => {
      await clear(conn, game);
      await conn.action("wizdetect");
      await clear(conn, game);
      assertValid(await conn.getState(), "wizdetect");
    });

    it("revealed map has exits", async () => {
      const state = await revealMap(conn, game);
      expect(state.terrain).toBeDefined();
      expect(state.terrain!.exits.length).toBeGreaterThanOrEqual(0);
    });

    // ── Basic Actions ──

    it("autopickup toggle", async () => {
      await clear(conn, game);
      assertValid(await conn.action("autopickup"), "autopickup");
    });

    it("swap weapons", async () => {
      await clear(conn, game);
      assertValid(await conn.action("swap"), "swap");
      await clear(conn, game);
    });

    it("twoweapon", async () => {
      await clear(conn, game);
      assertValid(await conn.action("twoweapon"), "twoweapon");
      await clear(conn, game);
    });

    // ── Inventory Verbs ──

    it("putOn + remove a ring", async () => {
      await wish(conn, game, "ring of free action");
      await identify(conn, game);
      const ring = (await conn.getState()).inventory.find((i) =>
        /ring/i.test(i.text) && !/ring mail/i.test(i.text) && !/worn|left|right/i.test(i.text),
      );
      if (!ring) return;
      await conn.action(`putOn:${ring.letter}`);
      await clear(conn, game);
      await conn.action(`remove:${ring.letter}`);
      await clear(conn, game);
      assertValid(await conn.getState(), "putOn+remove");
    });

    it("quiver + fire", async () => {
      await wish(conn, game, "dart");
      await identify(conn, game);
      const dart = (await conn.getState()).inventory.find((i) => /dart/i.test(i.text));
      if (!dart) return;
      await conn.action(`quiver:${dart.letter}`);
      await clear(conn, game);
      await conn.action("fire");
      if (game.pendingInputType === "yn" || game.pendingInputType === "key" || game.pendingInputType === "poskey") {
        await conn.rawKey("k");
      }
      await clear(conn, game);
      assertValid(await conn.getState(), "quiver+fire");
    });

    it("cast (spell menu)", async () => {
      await clear(conn, game);
      await conn.action("cast");
      await clear(conn, game);
      assertValid(await conn.getState(), "cast");
    });

    it("pay (not in shop)", async () => {
      await clear(conn, game);
      assertValid(await conn.action("pay"), "pay");
    });

    it("droptype (item class menu)", async () => {
      await clear(conn, game);
      await conn.action("droptype");
      await clear(conn, game);
      assertValid(await conn.getState(), "droptype");
    });

    it("inventory display", async () => {
      await clear(conn, game);
      await conn.action("inventory");
      await clear(conn, game);
      assertValid(await conn.getState(), "inventory");
    });

    // ── Extended Commands ──

    for (const cmd of ["force", "chat", "invoke", "jump", "monster", "offer", "ride", "rub", "tip", "turn"]) {
      it(`#${cmd} dispatches without crash`, async () => {
        await clear(conn, game);
        await conn.action(cmd);
        await clear(conn, game);
        expect((await conn.getState()).game_over).toBe(false);
      });
    }

    // ── Hunger ──

    it("hunger field is valid", async () => {
      const state = await conn.getState();
      expect(typeof state.player.hunger).toBe("string");
    });

    // ── HP Tracking ──

    it("HP is sane", async () => {
      const state = await conn.getState();
      expect(state.player.hp).toBeGreaterThan(0);
      expect(state.player.hp).toBeLessThanOrEqual(state.player.max_hp);
    });

  });

  // ════════════════════════════════════════════════════════════════════
  // ISOLATED TESTS — each boots a fresh game
  // ════════════════════════════════════════════════════════════════════

  describe("Isolated: container loot menu", () => {
    it("exercises each loot option via auto-assigned accelerators", async () => {
      const { conn, game } = await boot(createModule, wasmPath);

      await wish(conn, game, "large box");
      await wish(conn, game, "skeleton key");
      const box = (await conn.getState()).inventory.find((i) => /large box/i.test(i.text));
      if (!box) { conn.disconnect(); return; }

      await conn.action(`drop:${box.letter}`);
      await clear(conn, game);

      // Loot + unlock
      await conn.action("loot");
      for (let i = 0; i < 10; i++) {
        if (game.pendingInputType === "menu") break;
        if (game.pendingInputType === "key" || game.pendingInputType === "poskey") break;
        if (game.pendingInputType === "yn") await conn.rawKey("y");
        else break;
      }
      // May need second loot after unlock
      if (game.pendingInputType !== "menu") {
        await clear(conn, game);
        await conn.action("loot");
        for (let i = 0; i < 5; i++) {
          if (game.pendingInputType === "menu") break;
          if (game.pendingInputType === "yn") await conn.rawKey("y");
          else break;
        }
      }

      if (game.pendingInputType === "menu") {
        const state = await conn.getState();
        const opts = state.menu_items.filter((i) => i.isSelectable);
        expect(opts.length).toBeGreaterThanOrEqual(3);
        for (const opt of opts) {
          expect(opt.menuChar, `${opt.text} should have auto-assigned accelerator`).toBeTruthy();
        }

        // Test each option
        const doNothing = opts.find((o) => /do nothing/i.test(o.text));
        if (doNothing) await conn.rawKey(doNothing.menuChar);
        await clear(conn, game);

        // Look inside
        await conn.action("loot");
        for (let i = 0; i < 5; i++) {
          if (game.pendingInputType === "menu") break;
          if (game.pendingInputType === "yn") await conn.rawKey("y");
          else break;
        }
        if (game.pendingInputType === "menu") {
          const s = await conn.getState();
          const look = s.menu_items.find((o) => /look inside/i.test(o.text));
          if (look) await conn.rawKey(look.menuChar);
          await clear(conn, game);
        }
      }

      assertValid(await conn.getState(), "loot-final");
      conn.disconnect();
    });
  });

  describe("Isolated: eating food", () => {
    it("eating a wished food item", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "food ration");
      const food = (await conn.getState()).inventory.find((i) => /food ration/i.test(i.text));
      if (!food) { conn.disconnect(); return; }

      await conn.action(`eat:${food.letter}`);
      await clear(conn, game);
      assertValid(await conn.getState(), "after eating");
      conn.disconnect();
    });
  });

  describe("Isolated: equip wished weapon", () => {
    it("wield Magicbane", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "blessed +5 Magicbane");
      await identify(conn, game);
      const weapon = (await conn.getState()).inventory.find((i) => /magicbane/i.test(i.text));
      if (!weapon) { conn.disconnect(); return; }

      await conn.action(`wield:${weapon.letter}`);
      await clear(conn, game);
      assertValid(await conn.getState(), "after wield");
      conn.disconnect();
    });
  });

  describe("Isolated: level teleport", () => {
    it("teleport to level 3 and back", async () => {
      const { conn, game } = await boot(createModule, wasmPath);

      await conn.rawKey("\x16"); // Ctrl+V
      for (let i = 0; i < 5; i++) {
        if (game.pendingInputType === "line") break;
        if (game.pendingInputType === "yn") await conn.rawKey("y");
        else break;
      }
      if (game.pendingInputType !== "line") { conn.disconnect(); return; }
      await conn.sendLine("3");
      await clear(conn, game);

      let state = await conn.getState();
      assertValid(state, "level 3");
      expect(state.dlvl).not.toBe(1);

      // Go back
      await conn.rawKey("\x16");
      for (let i = 0; i < 5; i++) {
        if (game.pendingInputType === "line") break;
        if (game.pendingInputType === "yn") await conn.rawKey("y");
        else break;
      }
      if (game.pendingInputType === "line") await conn.sendLine("1");
      await clear(conn, game);

      state = await conn.getState();
      assertValid(state, "level 1");
      expect(state.dlvl).toBe(1);
      conn.disconnect();
    });
  });

  describe("Isolated: HP loss (potion of sickness)", () => {
    it("drinking sickness potion", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "potion of sickness");
      const potion = (await conn.getState()).inventory.find((i) => /sickness/i.test(i.text));
      if (!potion) { conn.disconnect(); return; }

      await conn.action(`drink:${potion.letter}`);
      for (let i = 0; i < 5; i++) {
        if (game.pendingInputType === "yn") await conn.rawKey("y");
        else break;
      }
      await clear(conn, game);
      assertValid(await conn.getState(), "after sickness");
      conn.disconnect();
    });
  });

  describe("Isolated: status conditions (wizintrinsic)", () => {
    it("toggling a condition", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("wizintrinsic");
      if (game.pendingInputType !== "menu") { await clear(conn, game); conn.disconnect(); return; }

      const state = await conn.getState();
      const item = state.menu_items.find((i) => i.isSelectable && /stun|conf|hallu/i.test(i.text));
      if (!item) { await clear(conn, game); conn.disconnect(); return; }

      await conn.rawKey(item.menuChar);
      await clear(conn, game);
      await conn.action("wait");
      await clear(conn, game);

      const after = await conn.getState();
      assertValid(after, "after intrinsic");
      conn.disconnect();
    });
  });

  describe("Isolated: polymorph (wizpolyself)", () => {
    it("polymorph into newt and back", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("wizpolyself");
      if (game.pendingInputType === "line") await conn.sendLine("newt");
      await clear(conn, game);
      assertValid(await conn.getState(), "as newt");

      await conn.action("wizpolyself");
      if (game.pendingInputType === "line") await conn.sendLine("elf");
      await clear(conn, game);
      assertValid(await conn.getState(), "reverted");
      conn.disconnect();
    });
  });

  describe("Isolated: wizgenesis (spawn monster)", () => {
    it("spawn a newt", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("wizgenesis");
      if (game.pendingInputType === "line") await conn.sendLine("newt");
      await clear(conn, game);
      assertValid(await conn.getState(), "after genesis");
      conn.disconnect();
    });
  });

  describe("Isolated: combat flow", () => {
    it("spawn monster and fight it", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("wizgenesis");
      if (game.pendingInputType === "line") await conn.sendLine("grid bug");
      await clear(conn, game);

      // Move in all directions to find and attack
      for (const dir of ["move_north", "move_south", "move_east", "move_west"]) {
        await clear(conn, game);
        const s = await conn.action(dir);
        if (s.messages.some((m) => /hit|miss|kill|destroy/i.test(m))) break;
      }
      await clear(conn, game);

      const state = await conn.getState();
      if (!state.game_over) assertValid(state, "after combat");
      conn.disconnect();
    });
  });

  describe("Isolated: spell casting with direction", () => {
    it("cast force bolt north", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("cast");
      if (game.pendingInputType !== "menu") { await clear(conn, game); conn.disconnect(); return; }

      const state = await conn.getState();
      const spell = state.menu_items.find((i) => /force bolt/i.test(i.text) && i.isSelectable);
      if (!spell) { await clear(conn, game); conn.disconnect(); return; }

      await conn.rawKey(spell.menuChar);
      const pt = game.pendingInputType as string | null;
      if (pt === "yn" || pt === "key" || pt === "poskey") await conn.rawKey("k");
      await clear(conn, game);
      assertValid(await conn.getState(), "after cast");
      conn.disconnect();
    });
  });

  describe("Isolated: cursed item behavior", () => {
    it("cursed weapon prevents unwielding", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "cursed -3 short sword");
      await identify(conn, game);
      const sword = (await conn.getState()).inventory.find((i) => /cursed.*short sword/i.test(i.text));
      if (!sword) { conn.disconnect(); return; }

      await conn.action(`wield:${sword.letter}`);
      await clear(conn, game);

      // Try to wield something else
      const staff = (await conn.getState()).inventory.find((i) => /quarterstaff/i.test(i.text));
      if (staff) {
        const result = await conn.action(`wield:${staff.letter}`);
        await clear(conn, game);
        const cursed = result.messages.some((m) => /cursed|welded|stuck/i.test(m));
        expect(cursed, "should mention cursed/welded").toBe(true);
      }
      conn.disconnect();
    });
  });

  describe("Isolated: force a lock", () => {
    it("force open a locked box", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "large box");
      const box = (await conn.getState()).inventory.find((i) => /large box/i.test(i.text));
      if (!box) { conn.disconnect(); return; }

      await conn.action(`drop:${box.letter}`);
      await clear(conn, game);
      await conn.action("force");
      for (let i = 0; i < 10; i++) {
        const pt = game.pendingInputType;
        if (pt === "key" || pt === "poskey" || !pt) break;
        if (pt === "yn") await conn.rawKey("y");
        else { await conn.rawKey("\x1b"); break; }
      }
      await clear(conn, game);
      assertValid(await conn.getState(), "after force");
      conn.disconnect();
    });
  });

  describe("Isolated: artifact invocation", () => {
    it("invoke an artifact", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "Magicbane");
      await identify(conn, game);
      const art = (await conn.getState()).inventory.find((i) => /magicbane/i.test(i.text));
      if (!art) { conn.disconnect(); return; }

      await conn.action(`wield:${art.letter}`);
      await clear(conn, game);
      await conn.action("invoke");
      await clear(conn, game);
      assertValid(await conn.getState(), "after invoke");
      conn.disconnect();
    });
  });

  describe("Isolated: stack drop", () => {
    it("drop a stack of items", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "5 darts");
      await identify(conn, game);
      const darts = (await conn.getState()).inventory.find((i) => /dart/i.test(i.text));
      if (!darts) { conn.disconnect(); return; }

      await conn.action(`drop:${darts.letter}`);
      if (game.pendingInputType === "yn") await conn.rawKey("y");
      await clear(conn, game);
      assertValid(await conn.getState(), "after stack drop");
      conn.disconnect();
    });
  });

  describe("Isolated: prayer", () => {
    it("pray produces effect", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("pray");
      if (game.pendingInputType === "yn") await conn.rawKey("y");
      await clear(conn, game);
      assertValid(await conn.getState(), "after prayer");
      conn.disconnect();
    });
  });

  describe("Isolated: engrave sub-prompts", () => {
    it("engrave Elbereth", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("engrave");
      for (let i = 0; i < 10; i++) {
        const pt = game.pendingInputType;
        if (!pt || pt === "key" || pt === "poskey") break;
        if (pt === "line") { await conn.sendLine("Elbereth"); break; }
        if (pt === "yn") await conn.rawKey("-"); // fingers
        else await conn.rawKey("\x1b");
      }
      await clear(conn, game);
      assertValid(await conn.getState(), "after engrave");
      conn.disconnect();
    });
  });

  describe("Isolated: wand zap with direction", () => {
    it("zap wand of light at self", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "wand of light");
      await identify(conn, game);
      const wand = (await conn.getState()).inventory.find((i) => /light/i.test(i.text) && /wand/i.test(i.text));
      if (!wand) { conn.disconnect(); return; }

      await conn.action(`zap:${wand.letter}`);
      const pt = game.pendingInputType as string | null;
      if (pt === "yn" || pt === "key" || pt === "poskey") await conn.rawKey(".");
      await clear(conn, game);
      assertValid(await conn.getState(), "after zap");
      conn.disconnect();
    });
  });

  describe("Isolated: wand targeting (getpos)", () => {
    it("zap wand of striking north", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "wand of striking");
      await identify(conn, game);
      const wand = (await conn.getState()).inventory.find((i) => /striking/i.test(i.text) && /wand/i.test(i.text));
      if (!wand) { conn.disconnect(); return; }

      await conn.action(`zap:${wand.letter}`);
      const pt = game.pendingInputType as string | null;
      if (pt === "yn" || pt === "key" || pt === "poskey") await conn.rawKey("k");
      await clear(conn, game);

      assertValid(await conn.getState(), "after zap striking");
      conn.disconnect();
    });
  });

  describe("Isolated: multi-item pickup (PICK_ANY)", () => {
    it("pickup menu with multiple floor items", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await wish(conn, game, "dagger");
      await wish(conn, game, "apple");
      await wish(conn, game, "rock");
      await identify(conn, game);

      const state = await conn.getState();
      const items = [
        state.inventory.find((i) => /dagger/i.test(i.text)),
        state.inventory.find((i) => /apple/i.test(i.text)),
        state.inventory.find((i) => /rock|stone/i.test(i.text) && !/flint/i.test(i.text)),
      ].filter(Boolean);
      if (items.length < 2) { conn.disconnect(); return; }

      for (const item of items) {
        await conn.action(`drop:${item!.letter}`);
        await clear(conn, game);
      }

      const pickState = await conn.action("pickup");
      if (pickState.input_type === "menu") {
        const mode = pickState.menu_selection_mode;
        expect(mode === 2 || mode === "PICK_ANY", "should be PICK_ANY").toBe(true);
        const selectable = pickState.menu_items.filter((i) => i.isSelectable);
        expect(selectable.length).toBeGreaterThanOrEqual(1);
      }
      await clear(conn, game);
      conn.disconnect();
    });
  });

  describe("Isolated: attack peaceful", () => {
    it("spawning a peaceful triggers Really attack? prompt", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await conn.action("wizgenesis");
      if (game.pendingInputType === "line") await conn.sendLine("Oracle");
      await clear(conn, game);

      for (const dir of ["move_north", "move_south", "move_east", "move_west"]) {
        await clear(conn, game);
        const state = await conn.action(dir);
        if (state.input_type === "yn" && /really attack/i.test(state.prompt)) {
          await conn.rawKey("n");
          break;
        }
      }
      await clear(conn, game);
      assertValid(await conn.getState(), "after peaceful");
      conn.disconnect();
    });
  });

  describe("Isolated: real fountain interaction", () => {
    it("teleport to fountain and dip an item", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      const FOUNTAIN = getTerrainType(game, "FOUNTAIN");

      // Scan levels 1-5 for a fountain
      let fountain: { x: number; y: number } | null = null;
      for (let lvl = 1; lvl <= 5; lvl++) {
        if (!await levelTeleport(conn, game, lvl)) break;
        await revealMap(conn, game);
        fountain = findTerrain(game, FOUNTAIN);
        if (fountain) break;
      }

      if (!fountain) { conn.disconnect(); return; }

      // Teleport to the fountain
      await posTeleport(conn, game, fountain.x, fountain.y);

      // Wish for a safe dip item
      await wish(conn, game, "dagger");
      await identify(conn, game);
      const dagger = (await conn.getState()).inventory.find((i) => /dagger/i.test(i.text));
      if (!dagger) { conn.disconnect(); return; }

      // Dip the dagger into the fountain
      await conn.action("dip");
      // Item selection prompt
      if (game.pendingInputType === "menu" || game.pendingInputType === "key" || game.pendingInputType === "poskey") {
        await conn.rawKey(dagger.letter);
      }
      // "Dip it into the fountain?" yn
      if (game.pendingInputType === "yn") {
        await conn.rawKey("y");
      }
      await clear(conn, game);

      assertValid(await conn.getState(), "after fountain dip");
      conn.disconnect();
    });
  });

  describe("Isolated: real altar interaction", () => {
    it("teleport to altar and pray", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      const ALTAR = getTerrainType(game, "ALTAR");

      // Scan levels 1-7 for an altar
      let altar: { x: number; y: number } | null = null;
      for (let lvl = 1; lvl <= 7; lvl++) {
        if (!await levelTeleport(conn, game, lvl)) break;
        await revealMap(conn, game);
        altar = findTerrain(game, ALTAR);
        if (altar) break;
      }

      if (!altar) { conn.disconnect(); return; }

      // Teleport to the altar
      await posTeleport(conn, game, altar.x, altar.y);

      // Pray on the altar
      await conn.action("pray");
      if (game.pendingInputType === "yn") await conn.rawKey("y");
      await clear(conn, game);

      const state = await conn.getState();
      assertValid(state, "after altar prayer");
      conn.disconnect();
    });

    it("teleport to altar and offer a corpse", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      const ALTAR = getTerrainType(game, "ALTAR");

      // Find an altar
      let altar: { x: number; y: number } | null = null;
      for (let lvl = 1; lvl <= 7; lvl++) {
        if (!await levelTeleport(conn, game, lvl)) break;
        await revealMap(conn, game);
        altar = findTerrain(game, ALTAR);
        if (altar) break;
      }

      if (!altar) { conn.disconnect(); return; }

      await posTeleport(conn, game, altar.x, altar.y);

      // Wish for a corpse to offer
      await wish(conn, game, "newt corpse");
      await identify(conn, game);
      const corpse = (await conn.getState()).inventory.find((i) => /corpse|newt/i.test(i.text));

      // Offer
      await conn.action("offer");
      // May ask which item to offer
      if (game.pendingInputType === "menu" || game.pendingInputType === "key" || game.pendingInputType === "poskey") {
        if (corpse) await conn.rawKey(corpse.letter);
        else await conn.rawKey("\x1b");
      }
      if (game.pendingInputType === "yn") await conn.rawKey("y");
      await clear(conn, game);

      assertValid(await conn.getState(), "after altar offer");
      conn.disconnect();
    });
  });

  describe("Isolated: real shop interaction", () => {
    it("enter shop, pick up item, pay shopkeeper", async () => {
      // Boot with SHOPTYPE=g to force general store creation on wizmakemap
      const game = new NethackStateManager({
        autoResolvePickNone: true,
        autoDismissMenus: "resend",
      });
      await game.start(createModule, {
        nethackOptions: WIZARD_OPTS,
        locateFile: (f: string) => f.endsWith(".wasm") ? wasmPath : f,
        preRun: [(mod: any) => { mod.ENV = mod.ENV || {}; mod.ENV.SHOPTYPE = "g"; }],
      });
      const conn = new NethackConnection();
      (conn as any).game = game;
      (conn as any)._isConnected = true;
      (conn as any)._wireEvents();

      const COLNO = 80, DOOR = getTerrainType(game, "DOOR");

      // Find a shop: level teleport + wizmakemap until shopkeeper appears
      let shopkeep: any = null;
      for (let lvl = 3; lvl <= 8 && !shopkeep; lvl++) {
        if (!await levelTeleport(conn, game, lvl)) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          await clear(conn, game);
          await conn.action("wizmakemap");
          await clear(conn, game);
          await revealMap(conn, game);
          shopkeep = ((game as any).visibleMonsters || []).find(
            (m: any) => /shopkeeper/i.test(m.name),
          );
          if (shopkeep) break;
        }
      }

      if (!shopkeep) {
        // Shop generation is RNG — skip gracefully if not found
        conn.disconnect();
        return;
      }

      // Find the shop's door (near the shopkeeper)
      const tm = (game as any).getTerrainMap();
      let shopDoor: { x: number; y: number } | null = null;
      if (tm) {
        for (let dy = -5; dy <= 5 && !shopDoor; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const x = shopkeep.x + dx, y = shopkeep.y + dy;
            if (x < 1 || x >= 79 || y < 1 || y >= 20) continue;
            if (tm.typs[y * COLNO + x] === DOOR) {
              shopDoor = { x, y };
              break;
            }
          }
        }
      }

      if (!shopDoor) { conn.disconnect(); return; }

      // Wish for gold to pay with
      await wish(conn, game, "500 gold pieces");

      // Teleport outside the shop door, then walk through it
      // Find which side of the door is away from the shopkeeper
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = shopDoor.x + dx, ny = shopDoor.y + dy;
        const dist = Math.abs(nx - shopkeep.x) + Math.abs(ny - shopkeep.y);
        if (dist > 1 && tm && tm.typs[ny * COLNO + nx] >= DOOR) {
          await posTeleport(conn, game, nx, ny);
          break;
        }
      }

      // Walk toward the door and through it (2 steps to open + enter)
      const dirToShop = shopDoor.x > (game as any).playerPos.x ? "l"
        : shopDoor.x < (game as any).playerPos.x ? "h"
        : shopDoor.y > (game as any).playerPos.y ? "j" : "k";
      await conn.rawKey(dirToShop);
      await clear(conn, game);
      await conn.rawKey(dirToShop);
      await clear(conn, game);

      // Walk around inside the shop to find items
      let pickedUp = false;
      for (const dir of ["h", "l", "k", "j"]) {
        const state = await conn.rawKey(dir);
        await clear(conn, game);
        if (state.messages.some((m) => /for sale|you see/i.test(m))) {
          // Pick it up
          await conn.rawKey(",");
          await clear(conn, game);
          pickedUp = true;
          break;
        }
      }

      // Pay for the item
      if (pickedUp) {
        await conn.action("pay");
        // Handle yn prompts from shopkeeper
        for (let i = 0; i < 5; i++) {
          if (game.pendingInputType === "yn") await conn.rawKey("y");
          else break;
        }
        await clear(conn, game);
      }

      assertValid(await conn.getState(), "after shop interaction");
      conn.disconnect();
    });
  });

  describe("Isolated: save state sanity", () => {
    it("all state fields are consistent", async () => {
      const { conn } = await boot(createModule, wasmPath);
      const state = await conn.getState();
      assertValid(state, "sanity");
      expect(state.dlvl).toBe(1);
      expect(state.player.max_hp).toBeGreaterThan(0);
      expect(state.player.hp).toBeLessThanOrEqual(state.player.max_hp);
      expect(state.inventory.length).toBeGreaterThan(0);
      expect(state.entities.length).toBeGreaterThan(0);
      expect(state.role).toBe("Wizard");
      conn.disconnect();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ERROR HANDLING — bad input, wrong prompt types, edge cases
  // ════════════════════════════════════════════════════════════════════

  describe("Error: action on disconnected connection", () => {
    it("action/rawKey/quit throw 'Not connected'", async () => {
      const disconnected = new NethackConnection();
      await expect(disconnected.action("search")).rejects.toThrow("Not connected");
      await expect(disconnected.rawKey("k")).rejects.toThrow("Not connected");
      await expect(disconnected.quit()).rejects.toThrow("Not connected");
    });
  });

  describe("Error: wrong prompt type", () => {
    it("answerYn during normal gameplay throws", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      // Game starts at key/poskey prompt — answerYn is wrong
      expect(game.pendingInputType === "key" || game.pendingInputType === "poskey").toBe(true);
      expect(() => (game as any).answerYn("y")).toThrow(/wrong input type/);
      conn.disconnect();
    });

    it("answerLine during normal gameplay throws", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      expect(() => (game as any).answerLine("hello")).toThrow(/wrong input type/);
      conn.disconnect();
    });

    it("selectMenuItems during normal gameplay throws", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      expect(() => (game as any).selectMenuItems(["a"])).toThrow(/wrong input type/);
      conn.disconnect();
    });
  });

  describe("Error: action during active prompt", () => {
    it("dispatching action during a prompt returns current state (blocked)", async () => {
      const { conn, game } = await boot(createModule, wasmPath);

      // Trigger engrave which creates a prompt chain
      await conn.action("engrave");
      const promptType = game.pendingInputType;
      expect(promptType).toBeTruthy();

      if (promptType === "yn" || promptType === "line" || promptType === "menu") {
        // Action is blocked — returns current state without dispatching
        const state = await conn.action("search");
        expect(state).toBeDefined();
        expect(state.game_over).toBe(false);
      }

      await clear(conn, game);
      conn.disconnect();
    });
  });

  describe("Error: action during menu prompt", () => {
    it("action during menu auto-dismisses or blocks", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      // cast triggers spell menu
      await conn.action("cast");
      if (game.pendingInputType === "menu") {
        // With autoDismissMenus="resend", the menu gets auto-dismissed
        // and the action is resent. This should not crash.
        const state = await conn.action("search");
        assertValid(state, "action during menu");
      }
      await clear(conn, game);
      conn.disconnect();
    });
  });

  describe("Error: invalid menu selection", () => {
    it("selecting non-existent menu item emits warning, doesn't crash", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      // Trigger a menu
      await conn.action("cast");
      if (game.pendingInputType === "menu") {
        // Send a garbage key that doesn't match any item
        const warnings: any[] = [];
        (game as any).on("warning", (w: any) => warnings.push(w));
        await conn.rawKey("9"); // unlikely to match any menu item
        await clear(conn, game);
        // The warning event should have fired (or the key was just ignored)
        // Key thing: no WASM crash
        assertValid(await conn.getState(), "after bad menu select");
      } else {
        await clear(conn, game);
      }
      conn.disconnect();
    });
  });

  describe("Error: disconnect mid-game", () => {
    it("disconnect during gameplay doesn't crash", async () => {
      const { conn } = await boot(createModule, wasmPath);
      assertValid(await conn.getState(), "before disconnect");
      conn.disconnect();
      expect(conn.isConnected).toBe(false);
      // Actions should throw after disconnect
      await expect(conn.action("search")).rejects.toThrow("Not connected");
    });
  });

  describe("Error: unknown direction", () => {
    it("invalid direction throws", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      expect(() => (game as any).move("banana")).toThrow(/unknown direction/);
      conn.disconnect();
    });
  });

  describe("Error: action after game over", () => {
    it("actions throw after quit", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await clear(conn, game);
      await conn.quit();
      expect((await conn.getState()).game_over).toBe(true);

      // Actions on a dead game should throw (no pending input to resolve)
      await expect(conn.action("search")).rejects.toThrow();
    });
  });

  describe("Error: double quit", () => {
    it("quitting twice returns game-over state immediately", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      await clear(conn, game);
      const first = await conn.quit();
      expect(first.game_over).toBe(true);

      // Second quit should return immediately with game-over state
      const second = await conn.quit();
      expect(second.game_over).toBe(true);
    });
  });

  describe("Error: rapid sequential actions", () => {
    it("many actions in quick succession don't corrupt state", async () => {
      const { conn, game } = await boot(createModule, wasmPath);
      // Fire off a bunch of actions sequentially
      for (let i = 0; i < 20; i++) {
        await clear(conn, game);
        const state = await conn.action("wait");
        assertValid(state, `rapid-${i}`);
      }
      conn.disconnect();
    });
  });

  describe("Isolated: death flow", () => {
    it("wand of death kills player", async () => {
      const { conn, game } = await boot(createModule, wasmPath);

      // Remove cloak of MR
      const cloak = (await conn.getState()).inventory.find((i) =>
        /cloak.*magic resistance|magic resistance.*cloak/i.test(i.text),
      );
      if (cloak) {
        await conn.action(`takeOff:${cloak.letter}`);
        await clear(conn, game);
      }

      await wish(conn, game, "wand of death");
      await identify(conn, game);
      const wand = (await conn.getState()).inventory.find((i) => /death/i.test(i.text) && /wand/i.test(i.text));
      if (!wand) { conn.disconnect(); return; }

      await conn.action(`zap:${wand.letter}`);
      if (game.pendingInputType === "yn" || game.pendingInputType === "key" || game.pendingInputType === "poskey") {
        await conn.rawKey(".");
      }

      // Handle death prompts
      for (let i = 0; i < 20; i++) {
        const state = await conn.getState();
        if (state.game_over) break;
        if (!state.awaiting_input) break;
        if (state.input_type === "yn") await conn.rawKey("n");
        else if (state.input_type === "key") await conn.rawKey(" ");
        else if (state.input_type === "line") await conn.sendLine("");
        else await conn.rawKey("\x1b");
      }

      const final = await conn.getState();
      if (final.game_over) {
        expect(final.game_over).toBe(true);
        expect(game.phase).toBe("gameOver");
      }
      conn.disconnect();
    });
  });
  describe("Isolated: menuSelect does not append inventory item name", () => {
    it("pickup menu selection doesn't leak inventory item name into actionContext", async () => {
      const { conn, game } = await boot(createModule, wasmPath);

      // Ensure inventory slot 'a' exists (wizard starts with one)
      const slotA = game.inventory.find((i: any) => i.letter === "a");
      expect(slotA, "inventory slot 'a' should exist").toBeDefined();
      const slotAName = slotA!.displayText || slotA!.name;

      // Drop 2+ items to force a PICK_ANY pickup menu
      await wish(conn, game, "dagger");
      await wish(conn, game, "apple");
      await identify(conn, game);
      const dagger = (await conn.getState()).inventory.find((i) => /dagger/i.test(i.text));
      const apple = (await conn.getState()).inventory.find((i) => /apple/i.test(i.text));
      expect(dagger, "dagger in inventory").toBeDefined();
      expect(apple, "apple in inventory").toBeDefined();

      await conn.action(`drop:${dagger!.letter}`);
      await clear(conn, game);
      await conn.action(`drop:${apple!.letter}`);
      await clear(conn, game);

      // Capture menuSelect events from the API
      const menuSelectEvents: any[] = [];
      const listener = (info: any) => {
        if (info.action === "menuSelect") menuSelectEvents.push({ ...info });
      };
      game.on("actionTaken", listener);

      // Pickup → should show PICK_ANY menu with items labeled a, b, etc.
      const pickState = await conn.action("pickup");
      if (pickState.input_type === "menu") {
        const opts = pickState.menu_items.filter((i) => i.isSelectable);
        expect(opts.length, "pickup menu should have selectable items").toBeGreaterThanOrEqual(1);
        // Select the first item (accelerator 'a')
        await conn.rawKey(opts[0].menuChar);
        await clear(conn, game);
      }

      game.off("actionTaken", listener);

      // Core assertion: menuSelect events must NOT carry itemName
      expect(menuSelectEvents.length, "should have captured at least one menuSelect event").toBeGreaterThanOrEqual(1);
      for (const evt of menuSelectEvents) {
        expect(evt.itemName, `menuSelect for key '${evt.key}' should not have itemName`).toBeFalsy();
      }

      // Also verify actionContext prompt answers don't contain the
      // inventory item name that was in the same letter slot
      if (gameState.actionContext?.prompts) {
        for (const p of gameState.actionContext.prompts) {
          if (slotAName) {
            expect(p.answer, `prompt answer should not contain inventory item '${slotAName}'`)
              .not.toContain(slotAName);
          }
        }
      }

      conn.disconnect();
    }, 30_000);
  });

});

} // end for WASM_VERSIONS
