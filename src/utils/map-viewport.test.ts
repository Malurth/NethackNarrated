import { describe, it, expect } from 'vitest';
import {
  clampPan,
  computeMinZoom,
  applyWheelZoom,
  reconcileViewport,
  playerFollowPan,
  type ViewportBounds,
} from './map-viewport';

// Standard test container: 800x600. Map: 400x200 natural size.
// Width-tight fit zoom = 800/400 = 2. Height-tight fit zoom = 600/200 = 3.
// computeMinZoom caps at 1 (map smaller than container at 1×).
// At zoom = 1: scaled map is 400x200 — centered in both axes.
// At zoom = 2: scaled map is 800x400 — exactly fills width, 200px dead
// space total on height (100 top, 100 bottom).
// At zoom = 3: scaled map is 1200x600 — exceeds width, exactly fills height.
const B: ViewportBounds = { cw: 800, ch: 600, mw: 400, mh: 200 };

describe('computeMinZoom', () => {
  it('caps at 1 when fit ratio exceeds 1 (small map in large container)', () => {
    // Width ratio = 2, height ratio = 3 → fit = 2, capped to 1.
    expect(computeMinZoom(B)).toBe(1);
  });

  it('returns fit ratio when it is below 1 (large map in small container)', () => {
    // Tall map: 200 wide, 800 tall. Width ratio = 4, height ratio = 0.75.
    // Tight axis is height → min(1, 4, 0.75) = 0.75.
    expect(computeMinZoom({ cw: 800, ch: 600, mw: 200, mh: 800 })).toBe(0.75);
  });

  it('returns 1 for zero-sized maps to avoid NaN/Infinity', () => {
    expect(computeMinZoom({ cw: 800, ch: 600, mw: 0, mh: 0 })).toBe(1);
  });

  it('returns 1 when map exactly fits container', () => {
    expect(computeMinZoom({ cw: 800, ch: 600, mw: 800, mh: 600 })).toBe(1);
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

  describe('with padding', () => {
    it('expands the allowed pan range by padding on each side', () => {
      // At zoom = 4: scaled map is 1600x800.
      //   Without padding: panX in [-800, 0], panY in [-200, 0].
      //   With padding 50: panX in [-850, 50], panY in [-250, 50].
      const p = clampPan({ x: 50, y: 50 }, 4, B, 50);
      expect(p.x).toBe(50);
      expect(p.y).toBe(50);

      const p2 = clampPan({ x: -850, y: -250 }, 4, B, 50);
      expect(p2.x).toBe(-850);
      expect(p2.y).toBe(-250);
    });

    it('still clamps beyond the padded range', () => {
      const p = clampPan({ x: 100, y: 100 }, 4, B, 50);
      expect(p.x).toBe(50);
      expect(p.y).toBe(50);

      const p2 = clampPan({ x: -900, y: -300 }, 4, B, 50);
      expect(p2.x).toBe(-850);
      expect(p2.y).toBe(-250);
    });

    it('centers when map+padding is still smaller than container', () => {
      // Small map: 100x50, zoom 1. Scaled = 100x50.
      // With padding 50: 100 + 100 = 200 < 800 → still center.
      const small: ViewportBounds = { cw: 800, ch: 600, mw: 100, mh: 50 };
      const p = clampPan({ x: 999, y: 999 }, 1, small, 50);
      expect(p.x).toBe((800 - 100) / 2);
      expect(p.y).toBe((600 - 50) / 2);
    });

    it('unlocks centering when padding makes map+padding >= container', () => {
      // Map 700 wide at zoom 1, container 800.
      // Without padding: 700 < 800 → centered at (800-700)/2 = 50.
      // With padding 60: 700 + 120 = 820 >= 800 → free pan.
      //   Range: [800 - 700 - 60, 60] = [40, 60].
      const b: ViewportBounds = { cw: 800, ch: 600, mw: 700, mh: 50 };
      const p = clampPan({ x: 55, y: 0 }, 1, b, 60);
      expect(p.x).toBe(55);
    });
  });
});

describe('applyWheelZoom', () => {
  const minZoom = 1;
  const maxZoom = 5;
  const startCentered = { zoom: 1, panX: 200, panY: 200 };

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

  it('passes padding through to clampPan', () => {
    // With large padding, pan is allowed past the normal range.
    const b: ViewportBounds = { cw: 800, ch: 600, mw: 400, mh: 400 };
    const start = { zoom: 3, panX: 0, panY: 0 }; // at top-left edge
    // Zoom in at top-left corner — without padding, panX/panY would be clamped to 0.
    // With padding, it can go positive.
    const v = applyWheelZoom(start, { x: 0, y: 0 }, -200, b, 1.5, 5, 0.0015, 100);
    // The anchor at (0,0) means pan should stay at 0 or go positive (into padding).
    expect(v.panX).toBeGreaterThanOrEqual(0);
    expect(v.panX).toBeLessThanOrEqual(100);
  });
});

describe('reconcileViewport', () => {
  it('initializes uninitialized viewport (zoom === 0) to minZoom centered', () => {
    const r = reconcileViewport({ zoom: 0, panX: 0, panY: 0 }, B);
    expect(r.minZoom).toBe(1);
    expect(r.viewport.zoom).toBe(1);
    // At zoom 1 both axes are smaller than container → both centered.
    expect(r.viewport.panX).toBe((800 - 400) / 2); // 200
    expect(r.viewport.panY).toBe((600 - 200) / 2); // 200
  });

  it('preserves user zoom on map update when still >= new minZoom', () => {
    // User zoomed in to 3.5; map grows such that new minZoom is 0.8.
    // User's chosen zoom is preserved.
    const newB: ViewportBounds = { cw: 800, ch: 600, mw: 1000, mh: 600 }; // minZoom = min(1, 0.8, 1) = 0.8
    const r = reconcileViewport({ zoom: 3.5, panX: -100, panY: -50 }, newB);
    expect(r.minZoom).toBe(0.8);
    expect(r.viewport.zoom).toBe(3.5);
  });

  it('bumps zoom up to new minZoom if user zoom dropped below the new fit', () => {
    // Large map: minZoom = min(1, 800/1600, 600/800) = 0.5.
    // User was at 0.3. Bump up to 0.5.
    const bigB: ViewportBounds = { cw: 800, ch: 600, mw: 1600, mh: 800 };
    const r = reconcileViewport({ zoom: 0.3, panX: 0, panY: 0 }, bigB);
    expect(r.viewport.zoom).toBe(0.5);
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

  it('passes padding through to clampPan', () => {
    // Large map at zoom 2: scaled 1600x1200. Without padding, panX range [-800, 0].
    // With padding 50: panX range [-850, 50].
    const bigB: ViewportBounds = { cw: 800, ch: 600, mw: 800, mh: 600 };
    const r = reconcileViewport({ zoom: 2, panX: 30, panY: 0 }, bigB, 50);
    expect(r.viewport.panX).toBe(30); // within padded range
  });
});

describe('playerFollowPan', () => {
  // Large map so we have room to test follow behavior.
  // Container 800x600, map 600x400 natural. At zoom 2: 1200x800.
  const FB: ViewportBounds = { cw: 800, ch: 600, mw: 600, mh: 400 };
  const margin = 0.3;

  it('does not move pan when player is inside the dead zone', () => {
    // Player at natural (300, 200) — center of the map.
    // At zoom 2, pan (-200, -100): player viewport pos = 300*2 + (-200) = 400, 200*2 + (-100) = 300.
    // Dead zone X: [240, 560], Y: [180, 420]. Player at (400, 300) → inside.
    const result = playerFollowPan(
      { zoom: 2, panX: -200, panY: -100 },
      { x: 300, y: 200 },
      FB,
      margin,
    );
    expect(result.panX).toBe(-200);
    expect(result.panY).toBe(-100);
  });

  it('adjusts panX when player drifts past the right dead-zone edge', () => {
    // Player at natural (500, 200). At zoom 2, pan (0, -100):
    //   pvx = 500*2 + 0 = 1000 → way past dzRight = 800*0.7 = 560.
    //   Expected newPanX = 560 - 500*2 = -440.
    const result = playerFollowPan(
      { zoom: 2, panX: 0, panY: -100 },
      { x: 500, y: 200 },
      FB,
      margin,
    );
    // Follow wants -440 but clamp floor is cw - mw*zoom = 800 - 1200 = -400.
    expect(result.panX).toBe(-400);
    expect(result.panY).toBe(-100); // Y unchanged (in dead zone)
  });

  it('adjusts panX when player drifts past the left dead-zone edge', () => {
    // Player at natural (50, 200). At zoom 2, pan (-400, -100):
    //   pvx = 50*2 + (-400) = -300 → past dzLeft = 800*0.3 = 240.
    //   Expected newPanX = 240 - 50*2 = 140 → clamped to 0 (can't go positive without padding).
    const result = playerFollowPan(
      { zoom: 2, panX: -400, panY: -100 },
      { x: 50, y: 200 },
      FB,
      margin,
    );
    expect(result.panX).toBe(0); // clamped
  });

  it('adjusts panY when player drifts past the bottom dead-zone edge', () => {
    // Player at natural (300, 350). At zoom 2, pan (-200, 0):
    //   pvy = 350*2 + 0 = 700 → past dzBottom = 600*0.7 = 420.
    //   Expected newPanY = 420 - 350*2 = -280.
    const result = playerFollowPan(
      { zoom: 2, panX: -200, panY: 0 },
      { x: 300, y: 350 },
      FB,
      margin,
    );
    expect(result.panY).toBe(-200); // clamped to floor: 600 - 400*2 = -200
  });

  it('adjusts both axes simultaneously', () => {
    // Player at far bottom-right corner.
    const result = playerFollowPan(
      { zoom: 2, panX: 0, panY: 0 },
      { x: 550, y: 380 },
      FB,
      margin,
    );
    // Both axes should have been adjusted.
    expect(result.panX).toBeLessThan(0);
    expect(result.panY).toBeLessThan(0);
  });

  it('respects padding when clamping the follow result', () => {
    // Player at far left edge, padding allows pan past 0.
    const result = playerFollowPan(
      { zoom: 2, panX: -400, panY: -100 },
      { x: 50, y: 200 },
      FB,
      margin,
      80, // 80px padding
    );
    // Without padding: clamped to 0. With padding 80: allowed up to 80.
    // newPanX = dzLeft - 50*2 = 240 - 100 = 140 → clamped to 80.
    expect(result.panX).toBe(80);
  });

  it('returns clamped result even when player is centered', () => {
    // Start with an out-of-range pan. Player is centered so follow
    // doesn't move it, but clampPan should still fix the range.
    const result = playerFollowPan(
      { zoom: 2, panX: 9999, panY: 9999 },
      { x: 300, y: 200 },
      FB,
      margin,
    );
    // Player at center: pvx = 300*2 + 9999 = 10599 → past dzRight.
    // So follow adjusts, then clamp fixes.
    expect(result.panX).toBeLessThanOrEqual(0);
    expect(result.panY).toBeLessThanOrEqual(0);
  });
});
