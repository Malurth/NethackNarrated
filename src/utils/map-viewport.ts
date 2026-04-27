/**
 * Pure-function viewport math for the pan/zoomable map display.
 *
 * Kept in its own module so the tricky clamp and anchor arithmetic can
 * be exhaustively unit-tested without spinning up jsdom, and so any
 * future viewport needing the same rules can reuse it.
 */

export interface ViewportBounds {
  /** Container (visible viewport) width in CSS pixels. */
  cw: number;
  /** Container height in CSS pixels. */
  ch: number;
  /** Map's natural (pre-scale) width in CSS pixels. */
  mw: number;
  /** Map's natural (pre-scale) height in CSS pixels. */
  mh: number;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Clamp pan so the container stays mostly inside the scaled map rect.
 *
 * `padding` (CSS pixels) relaxes the hard edge constraint, allowing the
 * map to be panned up to `padding` pixels past each edge. This gives
 * visual breathing room at the frontier of explored territory — the
 * player can see a strip of darkness past the known map, cueing them
 * that unexplored area exists.
 *
 * When padding is 0 (default), behavior is identical to the old
 * "no dead space ever" rule.
 */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  b: ViewportBounds,
  padding = 0,
): { x: number; y: number } {
  const sw = b.mw * zoom;
  const sh = b.mh * zoom;

  let x: number;
  if (sw + 2 * padding >= b.cw) {
    x = Math.min(padding, Math.max(b.cw - sw - padding, pan.x));
  } else {
    x = (b.cw - sw) / 2;
  }

  let y: number;
  if (sh + 2 * padding >= b.ch) {
    y = Math.min(padding, Math.max(b.ch - sh - padding, pan.y));
  } else {
    y = (b.ch - sh) / 2;
  }

  return { x, y };
}

/**
 * The minimum zoom level: the scale at which the map first fits the
 * container on both axes. Below this we'd be showing dead space on
 * the tight axis for no reason, so it becomes the zoom-out floor.
 */
export function computeMinZoom(b: ViewportBounds): number {
  if (b.mw === 0 || b.mh === 0) return 1;
  return Math.min(b.cw / b.mw, b.ch / b.mh);
}

/**
 * Apply a wheel-zoom step at a cursor position. The zoom is anchored to
 * the cursor — the map point under the cursor stays under the same
 * container-relative pixel — and then pan is clamped to the allowed
 * rectangle. Near an edge, the clamp "wins" over the anchor and the
 * zoom sticks to the edge rather than producing dead space.
 *
 * `deltaY` follows the WheelEvent convention: negative = scroll up
 * = zoom in.
 */
export function applyWheelZoom(
  current: Viewport,
  cursor: { x: number; y: number },
  deltaY: number,
  b: ViewportBounds,
  minZoom: number,
  maxZoom: number,
  speed = 0.0015,
  padding = 0,
): Viewport {
  const oldZoom = current.zoom;
  const rawNew = oldZoom * (1 - deltaY * speed);
  const newZoom = Math.max(minZoom, Math.min(maxZoom, rawNew));

  if (newZoom === oldZoom) return current;

  const factor = newZoom / oldZoom;
  const targetPanX = cursor.x - (cursor.x - current.panX) * factor;
  const targetPanY = cursor.y - (cursor.y - current.panY) * factor;

  const clamped = clampPan({ x: targetPanX, y: targetPanY }, newZoom, b, padding);
  return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
}

/**
 * Recompute viewport bounds after a map dimension change (new state
 * arrived, window resized, etc.). Zoom is clamped up if it dropped
 * below the new minimum (the fit-to-container floor), but never pulled
 * down — the user's choice of "how far zoomed in" is preserved across
 * map updates. Pan is re-clamped to the new bounds.
 *
 * If `zoom === 0` the viewport is treated as uninitialized and we seed
 * it to the computed minimum (the closest thing to the old auto-fit
 * behavior).
 */
export function reconcileViewport(
  current: Viewport,
  b: ViewportBounds,
  padding = 0,
): { viewport: Viewport; minZoom: number } {
  const minZoom = computeMinZoom(b);
  let zoom = current.zoom;
  if (zoom === 0 || zoom < minZoom) {
    zoom = minZoom;
  }
  const clamped = clampPan({ x: current.panX, y: current.panY }, zoom, b, padding);
  return {
    viewport: { zoom, panX: clamped.x, panY: clamped.y },
    minZoom,
  };
}

/**
 * Compute the pan offset needed to keep the player inside a dead-zone
 * rectangle centered in the viewport. If the player is already inside
 * the dead zone, the current pan is returned unchanged. If they've
 * drifted outside, pan is adjusted by the minimum amount to bring them
 * back to the dead-zone edge.
 *
 * @param current       Current viewport state.
 * @param playerNat     Player position in natural (zoom=1) map pixels,
 *                      relative to the top-left of the rendered map element.
 * @param b             Container + map dimensions.
 * @param marginFraction  Fraction of the viewport reserved as margin on
 *                        each side (0.3 = 30% margin, 40% center dead zone).
 * @param padding       Passed through to clampPan for edge relaxation.
 */
export function playerFollowPan(
  current: Viewport,
  playerNat: { x: number; y: number },
  b: ViewportBounds,
  marginFraction = 0.3,
  padding = 0,
): { panX: number; panY: number } {
  const { zoom, panX, panY } = current;

  // Player's position in viewport (container) coordinates.
  const pvx = playerNat.x * zoom + panX;
  const pvy = playerNat.y * zoom + panY;

  // Dead-zone boundaries.
  const dzLeft = b.cw * marginFraction;
  const dzRight = b.cw * (1 - marginFraction);
  const dzTop = b.ch * marginFraction;
  const dzBottom = b.ch * (1 - marginFraction);

  let newPanX = panX;
  if (pvx < dzLeft) newPanX = dzLeft - playerNat.x * zoom;
  else if (pvx > dzRight) newPanX = dzRight - playerNat.x * zoom;

  let newPanY = panY;
  if (pvy < dzTop) newPanY = dzTop - playerNat.y * zoom;
  else if (pvy > dzBottom) newPanY = dzBottom - playerNat.y * zoom;

  const clamped = clampPan({ x: newPanX, y: newPanY }, zoom, b, padding);
  return { panX: clamped.x, panY: clamped.y };
}
