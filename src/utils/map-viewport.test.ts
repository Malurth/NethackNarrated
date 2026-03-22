import { describe, it, expect } from 'vitest';
import {
  clampPan,
  computeMinZoom,
  applyWheelZoom,
  reconcileViewport,
  type ViewportBounds,
} from './map-viewport';

// Standard test container: 800x600. Map: 400x200 natural size.
// Width-tight fit zoom = 800/400 = 2. Height-tight fit zoom = 600/200 = 3.
// minZoom = min(2, 3) = 2 (width is the tight axis).
// At zoom = 2: scaled map is 800x400 — exactly fills width, 200px dead
// space total on height (100 top, 100 bottom).
// At zoom = 3: scaled map is 1200x600 — exceeds width, exactly fills height.
const B: ViewportBounds = { cw: 800, ch: 600, mw: 400, mh: 200 };

describe('computeMinZoom', () => {
  it('returns the tighter-axis fit ratio', () => {
    expect(computeMinZoom(B)).toBe(2); // width-tight
  });

  it('handles height-tight maps', () => {
    // Tall map: 200 wide, 800 tall. Width ratio = 4, height ratio = 0.75.
    // Tight axis is height → min(4, 0.75) = 0.75.
    expect(computeMinZoom({ cw: 800, ch: 600, mw: 200, mh: 800 })).toBe(0.75);
  });

  it('returns 1 for zero-sized maps to avoid NaN/Infinity', () => {
    expect(computeMinZoom({ cw: 800, ch: 600, mw: 0, mh: 0 })).toBe(1);
  });
});

describe('clampPan', () => {
  it('locks tight axis and centers loose axis at minZoom', () => {
    // At zoom = 2 (minZoom), scaled map is 800x400.
    //   Width 800 == cw → tight axis → clamp range [0, 0] → locked at 0.
    //   Height 400 < ch 600 → loose axis → centered at (600-400)/2 = 100.
    const p = clampPan({ x: 0, y: 0 }, 2, B);
    expect(p.x).toBe(0);
    expect(p.y).toBe(100);
  });

  it('ignores out-of-range attempts on the locked axis', () => {
    // Trying to pan the tight axis: still locked at 0.
    const p = clampPan({ x: -500, y: 0 }, 2, B);
    expect(p.x).toBe(0);
  });

  it('ignores out-of-range attempts on the centered axis', () => {
    // Trying to pan the centered (loose) axis: still locked at center.
    const p = clampPan({ x: 0, y: -1000 }, 2, B);
    expect(p.y).toBe(100);
    const p2 = clampPan({ x: 0, y: 9999 }, 2, B);
    expect(p2.y).toBe(100);
  });

  it('permits free pan within clamp window when zoomed in', () => {
    // At zoom = 4: scaled map is 1600x800. Both axes exceed container.
    //   Width 1600, cw 800 → panX range [-800, 0].
    //   Height 800, ch 600 → panY range [-200, 0].
    const centered = clampPan({ x: -400, y: -100 }, 4, B);
    expect(centered.x).toBe(-400);
    expect(centered.y).toBe(-100);
  });

  it('clamps pan to the right edge (panX floor)', () => {
    // Drag map far to the left of its allowed range.
    const p = clampPan({ x: -10000, y: -100 }, 4, B);
    expect(p.x).toBe(-800);
    expect(p.y).toBe(-100);
  });

  it('clamps pan to the left edge (panX ceiling of 0)', () => {
    const p = clampPan({ x: 10000, y: -100 }, 4, B);
    expect(p.x).toBe(0);
    expect(p.y).toBe(-100);
  });

  it('clamps pan to the top and bottom edges on the Y axis', () => {
    expect(clampPan({ x: -400, y: -10000 }, 4, B).y).toBe(-200);
    expect(clampPan({ x: -400, y: 10000 }, 4, B).y).toBe(0);
  });

  it('transitional zoom: tight axis clamped, loose axis still centered', () => {
    // zoom = 2.5: scaled width 1000 > cw 800 (free with clamp); scaled
    // height 500 < ch 600 (still locked to center at (600-500)/2 = 50).
    const p = clampPan({ x: -600, y: -400 }, 2.5, B);
    expect(p.x).toBe(-200); // clamp floor = 800 - 1000 = -200
    expect(p.y).toBe(50); // centered — user attempt ignored
  });
});

describe('applyWheelZoom', () => {
  const minZoom = 2;
  const maxZoom = 5;
  const startCentered = { zoom: 2, panX: 0, panY: 100 };

  it('zooms in on wheel-up (negative deltaY)', () => {
    const v = applyWheelZoom(startCentered, { x: 400, y: 300 }, -100, B, minZoom, maxZoom);
    expect(v.zoom).toBeGreaterThan(startCentered.zoom);
  });

  it('zooms out on wheel-down (positive deltaY) but not below minZoom', () => {
    // Already at minZoom — wheel down should be a no-op.
    const v = applyWheelZoom(startCentered, { x: 400, y: 300 }, 1000, B, minZoom, maxZoom);
    expect(v.zoom).toBe(minZoom);
    expect(v).toEqual(startCentered);
  });

  it('anchors zoom to the cursor position (cursor tile stays under cursor)', () => {
    // Pick a cursor position well inside the map, zoom in, and verify
    // that the map point under the cursor is still under the cursor
    // after the zoom. Use a taller map so both axes have free pan range
    // at the starting zoom (otherwise the clamp overrides the anchor).
    const tallB: ViewportBounds = { cw: 800, ch: 600, mw: 400, mh: 400 };
    const start = { zoom: 3, panX: -200, panY: -200 }; // well inside clamp on both axes
    const cursor = { x: 500, y: 250 };

    // Map point currently under the cursor:
    //   mapPoint = (cursor - pan) / zoom
    const mapX = (cursor.x - start.panX) / start.zoom;
    const mapY = (cursor.y - start.panY) / start.zoom;

    const v = applyWheelZoom(start, cursor, -100, tallB, 1.5, maxZoom);

    // After zoom, the same mapPoint should still be under the cursor:
    //   cursor == pan + mapPoint * zoom
    const onScreenX = v.panX + mapX * v.zoom;
    const onScreenY = v.panY + mapY * v.zoom;
    expect(onScreenX).toBeCloseTo(cursor.x, 6);
    expect(onScreenY).toBeCloseTo(cursor.y, 6);
  });

  it('sticks to the edge near a boundary (clamp overrides anchor)', () => {
    // Cursor at the right edge, zoomed in enough that both axes are free,
    // pan already at the right-edge clamp floor. Wheel-in at the edge
    // shouldn't let the map peel away from the edge to honor the anchor.
    const b: ViewportBounds = { cw: 800, ch: 600, mw: 400, mh: 400 };
    const start = { zoom: 3, panX: 800 - 400 * 3, panY: 0 }; // -400, 0
    // Cursor at the right edge of the container
    const v = applyWheelZoom(start, { x: 800, y: 300 }, -200, b, 1.5, 5);
    // Zoom increased
    expect(v.zoom).toBeGreaterThan(start.zoom);
    // Pan still at the right-edge clamp floor (panX == cw - mw*zoom).
    // toBeCloseTo because the raw anchor computation produces tiny
    // floating-point drift before the clamp snaps it into place.
    expect(v.panX).toBeCloseTo(b.cw - b.mw * v.zoom, 6);
  });

  it('caps zoom at maxZoom', () => {
    // Spam wheel-in until we would exceed max.
    const v = applyWheelZoom(startCentered, { x: 400, y: 300 }, -100000, B, minZoom, maxZoom);
    expect(v.zoom).toBe(maxZoom);
  });

  it('returns current viewport unchanged when already at a zoom bound and pushed further', () => {
    const atMax = { zoom: maxZoom, panX: -1000, panY: -500 };
    const v = applyWheelZoom(atMax, { x: 400, y: 300 }, -500, B, minZoom, maxZoom);
    expect(v).toEqual(atMax);
  });
});

describe('reconcileViewport', () => {
  it('initializes uninitialized viewport (zoom === 0) to minZoom centered', () => {
    const r = reconcileViewport({ zoom: 0, panX: 0, panY: 0 }, B);
    expect(r.minZoom).toBe(2);
    expect(r.viewport.zoom).toBe(2);
    // At minZoom the tight axis is locked at 0 and loose axis is centered.
    expect(r.viewport.panX).toBe(0);
    expect(r.viewport.panY).toBe(100);
  });

  it('preserves user zoom on map update when still >= new minZoom', () => {
    // User zoomed in to 3.5; map grows such that new minZoom is 2.5.
    // User's chosen zoom is preserved.
    const newB: ViewportBounds = { cw: 800, ch: 600, mw: 320, mh: 200 }; // minZoom = 2.5
    const r = reconcileViewport({ zoom: 3.5, panX: -100, panY: -50 }, newB);
    expect(r.minZoom).toBe(2.5);
    expect(r.viewport.zoom).toBe(3.5);
  });

  it('bumps zoom up to new minZoom if user zoom dropped below the new fit', () => {
    // User was at 1.2 (say, from an older state). New map's minZoom is 2.
    // Bump zoom up; never allow zoom below fit.
    const r = reconcileViewport({ zoom: 1.2, panX: 0, panY: 0 }, B);
    expect(r.viewport.zoom).toBe(2);
  });

  it('re-clamps pan to new bounds', () => {
    // User panned to the right edge at zoom 4. Then the map updated and
    // the bounds changed such that the previous pan is now out-of-range.
    // We start with zoom 4, pan = -800 (right-edge clamp for original B).
    // New bounds: same container but a smaller map (mw 200, mh 100).
    // At zoom 4, scaled = 800x400 — width exactly fills container, so
    // panX clamp range is [0, 0]; pan should snap to 0.
    const newB: ViewportBounds = { cw: 800, ch: 600, mw: 200, mh: 100 };
    const r = reconcileViewport({ zoom: 4, panX: -800, panY: -100 }, newB);
    expect(r.viewport.panX).toBe(0);
    // Height: 400 < 600 → centered at (600-400)/2 = 100.
    expect(r.viewport.panY).toBe(100);
  });
});
