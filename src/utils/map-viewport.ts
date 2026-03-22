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
 * Clamp pan so the container is always fully inside the scaled map rect.
 *
 * On axes where the scaled map is larger than the container, the pan
 * has a normal range `[cw - mw*zoom, 0]` that keeps the container inside
 * the map. On axes where the scaled map is *smaller* than the container,
 * there's geometric dead space no matter what, so we lock the pan to a
 * centered position (equal dead space on both sides). This matches the
 * pre-zoom visual where the fully-zoomed-out map was centered in the
 * container.
 */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  b: ViewportBounds,
): { x: number; y: number } {
  const sw = b.mw * zoom;
  const sh = b.mh * zoom;

  let x: number;
  if (sw >= b.cw) {
    // Map wider than container — free to pan within the clamp window.
    x = Math.min(0, Math.max(b.cw - sw, pan.x));
  } else {
    // Map narrower than container — center on this axis.
    x = (b.cw - sw) / 2;
  }

  let y: number;
  if (sh >= b.ch) {
    y = Math.min(0, Math.max(b.ch - sh, pan.y));
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
): Viewport {
  const oldZoom = current.zoom;
  const rawNew = oldZoom * (1 - deltaY * speed);
  const newZoom = Math.max(minZoom, Math.min(maxZoom, rawNew));

  if (newZoom === oldZoom) return current;

  const factor = newZoom / oldZoom;
  const targetPanX = cursor.x - (cursor.x - current.panX) * factor;
  const targetPanY = cursor.y - (cursor.y - current.panY) * factor;

  const clamped = clampPan({ x: targetPanX, y: targetPanY }, newZoom, b);
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
): { viewport: Viewport; minZoom: number } {
  const minZoom = computeMinZoom(b);
  let zoom = current.zoom;
  if (zoom === 0 || zoom < minZoom) {
    zoom = minZoom;
  }
  const clamped = clampPan({ x: current.panX, y: current.panY }, zoom, b);
  return {
    viewport: { zoom, panX: clamped.x, panY: clamped.y },
    minZoom,
  };
}
