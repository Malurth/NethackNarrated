// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import MapDisplay from './MapDisplay.svelte';
import { gameState } from '../state/game.svelte';

// jsdom does not implement ResizeObserver; MapDisplay uses it for scaling.
// Stub it with a no-op so the component can mount.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const COLNO = 80;
const ROWNO = 21;

/** Build a full 80x21 empty map row array, then place a small feature. */
function buildMap(placements: { x: number; y: number; ch: string }[]): string[] {
  const rows: string[] = Array.from({ length: ROWNO }, () => ' '.repeat(COLNO));
  for (const p of placements) {
    const row = rows[p.y];
    rows[p.y] = row.slice(0, p.x) + p.ch + row.slice(p.x + 1);
  }
  return rows;
}

/** Build a mapColors Uint8Array (80 * 21 bytes) with specific NLE color
 *  codes set at specific NetHack-coordinate positions. */
function buildMapColors(placements: { x: number; y: number; color: number }[]): Uint8Array {
  const mc = new Uint8Array(COLNO * ROWNO);
  for (const p of placements) {
    mc[p.y * COLNO + p.x] = p.color;
  }
  return mc;
}

describe('MapDisplay foreground color lookup', () => {
  beforeEach(() => {
    // Reset minimal gameState fields used by MapDisplay.
    gameState.map = [];
    gameState.entities = [];
    gameState.cursor = { x: 0, y: 0 };
    gameState.mapColors = new Uint8Array(0);
    gameState.player = {
      x: 0, y: 0, hp: 10, max_hp: 10, pw: 0, max_pw: 0,
      ac: 10, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      xp: 0, xp_level: 1, gold: 0, hunger: 'normal', score: 0, turn: 0, dlvl: 1,
    };
  });

  it('reads mapColors at the tile\'s real NetHack coordinate', () => {
    // Wall at NetHack (10, 5). minCol=10, minRow=5 — so the rendered
    // grid's top-left (cx=0, ry=0) corresponds to NetHack (10, 5).
    // getCellStyle receives already-real coords from the template.
    gameState.map = buildMap([{ x: 10, y: 5, ch: '-' }]);
    gameState.mapColors = buildMapColors([
      { x: 10, y: 5, color: 7 }, // CLR_GRAY (#bbbbbb → rgb(187,187,187))
    ]);

    const { container } = render(MapDisplay);
    const cells = container.querySelectorAll<HTMLSpanElement>('.map-cell');
    const wallCell = Array.from(cells).find(c => c.textContent === '-');
    expect(wallCell, 'wall cell should render').toBeTruthy();

    // Gray in NLE_COLORS[7] is #bbbbbb → rgb(187, 187, 187).
    const style = wallCell!.getAttribute('style') || '';
    expect(style).toContain('rgb(187, 187, 187)');
  });

  it('uses the mapColors byte for entity tiles regardless of entity list ordering (regression)', () => {
    // Previously MapDisplay merged gameState.entities into an
    // entityColorMap to assign per-tile colors, which meant a gold
    // piece on a fountain inherited the fountain's blue color (because
    // features were pushed last and Map.set overwrote the gold).
    // Now we read directly from mapColors, which is NetHack's own
    // priority-resolved top-glyph color — so the order of entries in
    // gameState.entities is irrelevant to rendering.
    //
    // Setup: mapColors says "CLR_YELLOW at (10,5)" (NetHack resolved
    // top glyph to a gold piece). entities contains a fountain at the
    // same tile LAST — the old broken pattern would have let that
    // overwrite the gold's color. With the new code, the fountain
    // entity is ignored by the color lookup entirely.
    gameState.map = buildMap([{ x: 10, y: 5, ch: '$' }]);
    gameState.mapColors = buildMapColors([
      { x: 10, y: 5, color: 11 }, // CLR_YELLOW (#ffff44 → rgb(255,255,68))
    ]);
    gameState.entities = [
      { type: 'item', x: 10, y: 5, category: 'coin', char: '$', color: 11, name: 'gold' },
      { type: 'item', x: 10, y: 5, category: 'fountain', char: '{', color: 4, name: 'fountain' },
    ];

    const { container } = render(MapDisplay);
    const cells = container.querySelectorAll<HTMLSpanElement>('.map-cell');
    const goldCell = Array.from(cells).find(c => c.textContent === '$');
    expect(goldCell, 'gold $ cell should render').toBeTruthy();

    const style = goldCell!.getAttribute('style') || '';
    // CLR_YELLOW (11) = #ffff44 → rgb(255, 255, 68)
    expect(style).toContain('rgb(255, 255, 68)');
    // CLR_BLUE (4) = #4466cc → rgb(68, 102, 204) — the old bug's color
    expect(style).not.toContain('rgb(68, 102, 204)');
  });

  it('uses mapColors for a monster on a stairway regardless of entity ordering', () => {
    // Same bug class: pet on stairway used to inherit the stairway's
    // yellow color. mapColors-driven rendering is impervious because
    // it reads NetHack's resolved color directly.
    gameState.map = buildMap([{ x: 10, y: 5, ch: 'f' }]);
    gameState.mapColors = buildMapColors([
      { x: 10, y: 5, color: 2 }, // CLR_GREEN (#33bb33 → rgb(51,187,51))
    ]);
    gameState.entities = [
      { type: 'monster', x: 10, y: 5, name: 'kitten', char: 'f', color: 2, pet: true },
      { type: 'item', x: 10, y: 5, category: 'staircase up', char: '<', color: 11, name: 'staircase up' },
    ];

    const { container } = render(MapDisplay);
    const cells = container.querySelectorAll<HTMLSpanElement>('.map-cell');
    const kittenCell = Array.from(cells).find(c => c.textContent === 'f');
    expect(kittenCell, 'kitten f cell should render').toBeTruthy();

    const style = kittenCell!.getAttribute('style') || '';
    // CLR_GREEN (2) = #33bb33 → rgb(51, 187, 51)
    expect(style).toContain('rgb(51, 187, 51)');
    // CLR_YELLOW (11) = #ffff44 → rgb(255, 255, 68) — the old bug's color
    expect(style).not.toContain('rgb(255, 255, 68)');
  });

  it('falls back to the structural color when mapColors has no byte for a tile', () => {
    // Wall with no color byte — should use the dark wall structural color.
    gameState.map = buildMap([{ x: 10, y: 5, ch: '-' }]);
    gameState.mapColors = new Uint8Array(COLNO * ROWNO); // all zeros

    const { container } = render(MapDisplay);
    const cells = container.querySelectorAll<HTMLSpanElement>('.map-cell');
    const wallCell = Array.from(cells).find(c => c.textContent === '-');
    expect(wallCell).toBeTruthy();

    // getStructuralColor('-') returns '#1e2c3a' → rgb(30, 44, 58)
    const style = wallCell!.getAttribute('style') || '';
    expect(style).toContain('rgb(30, 44, 58)');
  });
});
