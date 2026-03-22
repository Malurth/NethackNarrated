/**
 * Wizard-mode integration tests for floor object pile enumeration.
 *
 * Verifies that visibleItems includes ALL items at a position (not just
 * the topmost glyph), with correct `obscured` flags.
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
  name: "PileTest",
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
  // Rest one turn to ensure the floor scan runs in display_nhwindow
  await conn.rawKey(".");
  await clear(conn, game);
}

for (const { label, createModule, wasmPath } of WASM_VERSIONS) {

describe.sequential(`Floor Object Piles [${label}]`, () => {
  let conn: NethackConnection;
  let game: NethackStateManager;

  beforeAll(async () => {
    ({ conn, game } = await boot(createModule, wasmPath));
  }, 30_000);
  afterAll(() => { conn.disconnect(); });

  it("visibleItems is an array after game boot", async () => {
    expect(Array.isArray(game.visibleItems)).toBe(true);
  });

  it("items dropped at player position are found by C scan with obscured=true", async () => {
    await wish(conn, game, "large box");
    const box = game.inventory.find((i: any) => /large box/i.test(i.displayText || i.text || ""));
    expect(box, "large box in inventory").toBeDefined();

    await drop(conn, game, box!.letter);

    const pos = game.playerPos;
    const atPlayer = game.visibleItems.filter((i: any) => i.x === pos.x && i.y === pos.y);
    expect(atPlayer.length, "item found at player position").toBeGreaterThanOrEqual(1);
    for (const item of atPlayer) {
      expect(item.obscured, "item obscured by player standing on it").toBe(true);
    }
  });

}, 30_000);
}
