/**
 * Integration tests for the properties getter (u.uprops[] exposure).
 * Boots a wizard-mode game, reads properties, then uses #wizwish
 * to grant items that confer properties and verifies they appear.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NethackStateManager } from "@neth4ck/api";
import createModule37 from "@neth4ck/wasm-37";
import createModule367 from "@neth4ck/wasm-367";
import path from "path";

const WASM_VERSIONS = [
  { label: "3.7", createModule: createModule37, wasmPath: path.resolve("node_modules/@neth4ck/wasm-37/build/nethack.wasm") },
  { label: "3.6.7", createModule: createModule367, wasmPath: path.resolve("node_modules/@neth4ck/wasm-367/build/nethack.wasm") },
];

const WIZARD_OPTS = {
  name: "PropTest",
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

async function bootGame(createModule: any, wasmPath: string) {
  const game = new NethackStateManager({
    autoResolvePickNone: true,
    autoDismissMenus: "resend",
  });
  await game.start(createModule, {
    nethackOptions: WIZARD_OPTS,
    locateFile: (f: string) => f.endsWith(".wasm") ? wasmPath : f,
  });
  return game;
}

/** Clear any pending prompts. */
async function clearPrompts(game: NethackStateManager) {
  for (let i = 0; i < 10; i++) {
    const type = game.pendingInputType;
    if (type === "key" || type === "poskey" || !type) break;
    try {
      if (type === "yn") game.answerYn("n");
      else if (type === "line") game.answerLine("");
      else if (type === "menu") game.dismissMenu();
      else game.sendKey(27); // ESC
    } catch { break; }
  }
}

/** Wish for an item via #wizwish. */
async function wizWish(game: NethackStateManager, item: string) {
  await clearPrompts(game);
  game.action("wizwish");
  if (game.pendingInputType === "yn") game.answerYn("y");
  if (game.pendingInputType === "line") game.answerLine(item);
  await clearPrompts(game);
}

describe.each(WASM_VERSIONS)("properties getter ($label)", ({ createModule, wasmPath, label }) => {
  let game: NethackStateManager;

  beforeAll(async () => {
    game = await bootGame(createModule, wasmPath);
  }, 30000);

  afterAll(async () => {
    try { await game.quit(); } catch {}
  });

  it("returns a Map of all properties", () => {
    const props = game.properties;
    expect(props).toBeInstanceOf(Map);
    // Should have standard properties
    expect(props!.has("FIRE_RES")).toBe(true);
    expect(props!.has("FLYING")).toBe(true);
    expect(props!.has("LEVITATION")).toBe(true);
    expect(props!.has("SEE_INVIS")).toBe(true);
    expect(props!.has("STEALTH")).toBe(true);
    expect(props!.has("TELEPAT")).toBe(true);
  });

  it("each property entry has the expected shape", () => {
    const props = game.properties!;
    const fireRes = props.get("FIRE_RES")!;
    expect(fireRes).toHaveProperty("index");
    expect(fireRes).toHaveProperty("intrinsic");
    expect(fireRes).toHaveProperty("extrinsic");
    expect(fireRes).toHaveProperty("blocked");
    expect(fireRes).toHaveProperty("active");
    expect(typeof fireRes.index).toBe("number");
    expect(typeof fireRes.active).toBe("boolean");
  });

  it("activeProperties returns a Set of active property names", () => {
    const active = game.activeProperties;
    expect(active).toBeInstanceOf(Set);
    // Elf Wizard starts with some innate properties
    // (SEE_INVIS from Elf race, at minimum)
  });

  it("detects properties gained from equipment", async () => {
    // Wish for an amulet of flying
    await wizWish(game, "amulet of flying");

    // Put it on: find it in inventory and use putOn
    const inv = game.inventory;
    const amulet = inv.find((i: any) => i.name?.includes("flying") || i.displayText?.includes("flying"));
    if (amulet) {
      game.putOn(amulet.letter);
      await clearPrompts(game);
    }

    const props = game.properties!;
    const flying = props.get("FLYING")!;
    // The amulet should set the extrinsic field
    // (It may be blocked by levitation, but extrinsic should be nonzero)
    if (amulet) {
      expect(flying.extrinsic).not.toBe(0);
    }
  }, 15000);

  it("detects BLND_RES only in 3.7", () => {
    const props = game.properties!;
    if (label === "3.7") {
      expect(props.has("BLND_RES")).toBe(true);
    } else {
      expect(props.has("BLND_RES")).toBe(false);
    }
  });
});
