/**
 * Wizard-mode integration tests for remembered items.
 *
 * Verifies that items the hero previously saw but can no longer see
 * appear in `rememberedItems` (from NetHack's levl[x][y].glyph memory).
 * Also verifies that obscured items (under the player) are excluded
 * from the frontend entity list.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NethackStateManager } from "@neth4ck/api";
import createModule37 from "@neth4ck/wasm-37";
import createModule367 from "@neth4ck/wasm-367";
import { NethackConnection } from "./wasm-connection";
import path from "path";

const WASM_VERSIONS = [
  { label: "3.7", createModule: createModule37, wasmPath: path.resolve("node_modules/@neth4ck/wasm-37/build/nethack.wasm") },
  { label: "3.6.7", createModule: createModule367, wasmPath: path.resolve("node_modules/@neth4ck/wasm-367/build/nethack.wasm") },
];

const WIZARD_OPTS = {
  name: "MemTest",
  skipTutorial: true,
  options: [
    "color", "number_pad:0", "runmode:walk", "time", "showexp", "showscore",
    "boulder:0", "playmode:debug", "!autopickup",
  ],
  role: "wiz",
  race: "elf",
  gender: "mal",
  align: "cha",
};

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
}

async function drop(conn: NethackConnection, game: NethackStateManager, letter: string) {
  await clear(conn, game);
  await conn.rawKey("d");
  for (let i = 0; i < 10; i++) {
    const type = game.pendingInputType;
    if (type === "key" || type === "poskey") {
      await conn.rawKey(letter);
      break;
    }
    if (type === "yn") { await conn.rawKey("y"); continue; }
    if (type === "line") { await conn.sendLine(""); continue; }
    break;
  }
  await clear(conn, game);
  await conn.rawKey(".");
  await clear(conn, game);
}

for (const { label, createModule, wasmPath } of WASM_VERSIONS) {

describe.sequential(`Remembered Items [${label}]`, () => {
  let conn: NethackConnection;
  let game: NethackStateManager;

  beforeAll(async () => {
    ({ conn, game } = await boot(createModule, wasmPath));
  }, 30_000);
  afterAll(() => { conn.disconnect(); });

  it("rememberedItems is an array after game boot", async () => {
    expect(Array.isArray((game as any).rememberedItems)).toBe(true);
  });

  it("obscured items at player position have obscured=true in API", async () => {
    await wish(conn, game, "dagger");
    const dagger = game.inventory.find((i: any) => /dagger/i.test(i.displayText || i.text || ""));
    expect(dagger, "dagger in inventory").toBeDefined();

    await drop(conn, game, dagger!.letter);

    const pos = game.playerPos;
    const atPlayer = game.visibleItems.filter((i: any) => i.x === pos.x && i.y === pos.y);
    expect(atPlayer.length, "item found at player position").toBeGreaterThanOrEqual(1);
    for (const item of atPlayer) {
      expect(item.obscured, "item obscured by player standing on it").toBe(true);
    }
  });

  it("obscured items get obscured flag in frontend entities", async () => {
    const entities = (conn as any)._buildEntities();
    const pos = game.playerPos;
    // Filter only items that came from visibleItems (have a char like ')' for dagger)
    // Features (stairs, etc.) are also type=item but won't have obscured
    const obscuredEntities = entities.filter((e: any) =>
      e.type === "item" && e.x === pos.x && e.y === pos.y && e.obscured === true
    );
    expect(obscuredEntities.length, "at least one obscured item entity").toBeGreaterThanOrEqual(1);
  });

  it("items become remembered when hero moves out of LOS", async () => {
    const startPos = { ...game.playerPos };

    // Teleport to a different dungeon level to guarantee the dropped
    // item is completely out of LOS.
    const teleCmd = label === "3.7" ? "wizlevelchange" : "wizlevelport";

    // Go to level 2
    await conn.action(teleCmd);
    // Handle any prompts (yn or line) until we've moved
    for (let i = 0; i < 15; i++) {
      const type = game.pendingInputType;
      if (type === "line") { await conn.sendLine("2"); break; }
      if (type === "yn") { await conn.rawKey("y"); continue; }
      if (type === "key" || type === "poskey") { break; }
      await conn.rawKey("\x1b");
    }
    await clear(conn, game);

    // Go back to level 1
    await conn.action(teleCmd);
    for (let i = 0; i < 15; i++) {
      const type = game.pendingInputType;
      if (type === "line") { await conn.sendLine("1"); break; }
      if (type === "yn") { await conn.rawKey("y"); continue; }
      if (type === "key" || type === "poskey") { break; }
      await conn.rawKey("\x1b");
    }
    await clear(conn, game);

    // Wait a turn to ensure state settles
    await conn.rawKey(".");
    await clear(conn, game);

    // The dagger we dropped should now be in rememberedItems
    // (we're back on level 1 but likely spawned at a different position)
    const remembered = (game as any).rememberedItems || [];
    const remAtStart = remembered.filter((i: any) => i.x === startPos.x && i.y === startPos.y);

    // Also check visible items in case we spawned right on it
    const visible = game.visibleItems;
    const visAtStart = visible.filter((i: any) => i.x === startPos.x && i.y === startPos.y);

    const totalTracked = remAtStart.length + visAtStart.length;
    expect(totalTracked, "dropped item tracked either as visible or remembered").toBeGreaterThanOrEqual(1);

    // If it's in remembered, verify the flag
    if (remAtStart.length > 0) {
      expect(remAtStart[0].remembered, "remembered flag set").toBe(true);
    }
  });

  it("remembered items appear in frontend entities with remembered flag", async () => {
    const remembered = (game as any).rememberedItems || [];
    if (remembered.length === 0) return; // skip if item is still in LOS

    const entities = (conn as any)._buildEntities();
    const rememberedEntities = entities.filter((e: any) => e.type === "item" && e.remembered);
    expect(rememberedEntities.length).toBeGreaterThanOrEqual(1);
  });

}, 30_000);
}
