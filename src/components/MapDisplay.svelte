<script lang="ts">
  import { gameState } from '../state/game.svelte';
  import { connection } from '../services/wasm-connection';
  import { NLE_COLORS, getStructuralColor } from '../utils/colors';
  import {
    applyWheelZoom,
    reconcileViewport,
    clampPan,
    type ViewportBounds,
  } from '../utils/map-viewport';

  // Player blink state (toggles every 550ms like Claude plays)
  let blink = $state(true);
  $effect(() => {
    const t = setInterval(() => blink = !blink, 550);
    return () => clearInterval(t);
  });

  // Monsters that get glow effect (from Claude plays JSX)
  const GLOW_CHARS = new Set('fFkorgZhBJd'.split(''));

  // Tooltip lookup: position → entity name. First-entry-wins so the
  // topmost thing at a tile is what the user sees on hover (matches
  // NetHack's render priority; the wasm-connection entity list is
  // ordered monsters → items → features). Colors are NOT looked up
  // through this map — they come from gameState.mapColors, which is
  // NetHack's priority-resolved per-tile top-glyph color. See
  // @neth4ck/api's `get map()` JSDoc for why.
  let entityTooltipMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const e of gameState.entities) {
      const key = `${e.x},${e.y}`;
      if (map.has(key)) continue;
      const name = e.type === 'monster' ? e.name : (e as any).category ?? 'item';
      map.set(key, name);
    }
    return map;
  });

  // Crop empty rows/cols like Claude plays JSX
  let croppedMap = $derived.by(() => {
    const rows = gameState.map;
    if (!rows || rows.every(r => !r.trim())) return { rows: [], minCol: 0 };

    const nonEmptyIdx = rows.map((_, i) => i).filter(i => rows[i].trim());
    const minRow = nonEmptyIdx[0] ?? 0;
    const maxRow = nonEmptyIdx[nonEmptyIdx.length - 1] ?? rows.length - 1;
    const cropped = rows.slice(minRow, maxRow + 1);

    const minCol = Math.min(...cropped.map(r => { const m = r.search(/\S/); return m === -1 ? 9999 : m; }));
    const maxCol = Math.max(...cropped.map(r => r.trimEnd().length));

    return {
      rows: cropped.map(r => r.slice(minCol, maxCol)),
      minCol,
      minRow,
    };
  });

  function isEntity(char: string): boolean {
    return /[a-zA-Z@%!?=$\/\(\)\[\]\*]/.test(char) && char !== ' ';
  }

  function getCellStyle(char: string, x: number, y: number): string {
    const isCursor = gameState.cursor && x === gameState.cursor.x && y === gameState.cursor.y;
    const isEnt = isCursor || isEntity(char);

    // Color comes from gameState.mapColors, which is NetHack's own
    // priority-resolved top-glyph color for each tile (monster > item
    // > feature > terrain). We never have to merge the separate
    // visible* entity lists ourselves — that's how you get bugs like
    // "gold on a fountain renders blue" or "pet on a stairway renders
    // yellow". Falls back to the structural color when no byte is
    // available (e.g. unseen tile, empty cell between crop extents).
    let color: string;
    if (isCursor) {
      color = blink ? '#ffffff' : '#00ff88';
    } else {
      const COLNO = 80;
      const mc = gameState.mapColors;
      const idx = y * COLNO + x;
      const raw = mc && idx >= 0 && idx < mc.length ? mc[idx] : 0;
      // raw > 0 means NetHack actually drew something here with a
      // meaningful color. CLR_BLACK (0) is used as the default for
      // empty/unseen tiles so we can treat it as "no color, fall back."
      color = raw > 0
        ? (NLE_COLORS[raw] ?? getStructuralColor(char))
        : getStructuralColor(char);
    }

    // Only emit color-dependent styles inline. The geometric styles
    // (display, width, font-size) live in the .map-cell CSS rule so
    // they can use calc(... * var(--zoom)) and get re-rasterized
    // crisply at the current zoom level — a CSS transform: scale()
    // just stretches the rendered bitmap and produces blurry text.
    let style = `color:${color};`;

    // Bold for entities
    if (isEnt) {
      style += 'font-weight:bold;';
    }

    // Glow for player and specific monster chars
    if (isCursor || GLOW_CHARS.has(char)) {
      style += `text-shadow:0 0 calc(7px * var(--zoom, 1)) ${color}88;`;
    }

    return style;
  }

  function getTooltip(x: number, y: number): string {
    return entityTooltipMap.get(`${x},${y}`) ?? '';
  }

  // ── Viewport state (user-controlled pan + zoom) ──────────────────
  // Replaces the old auto-fit scale. Wheel scrolls zoom around the
  // cursor, middle-mouse drag pans, and the clamp math in
  // `utils/map-viewport.ts` keeps the container fully inside the
  // rendered map rectangle at all times — no dead space past the
  // map edges is ever pannable to.
  const MAX_ZOOM = 5;

  let containerEl: HTMLDivElement;
  let mapEl: HTMLPreElement;

  let zoom = $state(0); // 0 = uninitialized; seeded to minZoom on first measure
  let panX = $state(0);
  let panY = $state(0);
  let minZoom = $state(1);
  let isDragging = $state(false);

  // Scratch state held across a middle-mouse drag
  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

  /** Read current container/map dimensions. Returns natural (zoom=1)
   *  map dimensions so the clamp math in map-viewport.ts can keep
   *  multiplying by zoom internally. Since we now scale the map via
   *  font-size + cell-width (not a CSS transform scale), mapEl's live
   *  offsetWidth/offsetHeight already reflect the current effective
   *  zoom — so we divide it back out to recover the baseline.
   *  Returns null before either element is attached or while the map
   *  has zero dimensions. */
  function readBounds(): ViewportBounds | null {
    if (!containerEl || !mapEl) return null;
    const cw = containerEl.clientWidth;
    const ch = containerEl.clientHeight;
    const effectiveZoom = zoom || 1; // matches the --zoom CSS fallback
    const mw = mapEl.offsetWidth / effectiveZoom;
    const mh = mapEl.offsetHeight / effectiveZoom;
    if (mw === 0 || mh === 0 || cw === 0 || ch === 0) return null;
    return { cw, ch, mw, mh };
  }

  function updateBounds() {
    const b = readBounds();
    if (!b) return;
    const { viewport, minZoom: newMin } = reconcileViewport(
      { zoom, panX, panY },
      b,
    );
    minZoom = newMin;
    zoom = viewport.zoom;
    panX = viewport.panX;
    panY = viewport.panY;
  }

  function handleWheel(e: WheelEvent) {
    const b = readBounds();
    if (!b) return;
    e.preventDefault();
    const rect = containerEl.getBoundingClientRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const v = applyWheelZoom(
      { zoom, panX, panY },
      cursor,
      e.deltaY,
      b,
      minZoom,
      MAX_ZOOM,
    );
    zoom = v.zoom;
    panX = v.panX;
    panY = v.panY;
  }

  function handlePointerDown(e: PointerEvent) {
    // Middle mouse button only — left click still reaches cells for
    // click-to-move, right click is left for the browser context menu.
    if (e.button !== 1) return;
    e.preventDefault();
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY, panX, panY };
    containerEl.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const b = readBounds();
    if (!b) return;
    const nextX = dragStart.panX + (e.clientX - dragStart.x);
    const nextY = dragStart.panY + (e.clientY - dragStart.y);
    const clamped = clampPan({ x: nextX, y: nextY }, zoom, b);
    panX = clamped.x;
    panY = clamped.y;
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    if (containerEl.hasPointerCapture?.(e.pointerId)) {
      containerEl.releasePointerCapture(e.pointerId);
    }
  }

  $effect(() => {
    // Re-run when map data changes — new turn / new level / new game.
    croppedMap.rows;
    // Wait a frame so the DOM has the new content laid out before we
    // measure mapEl.offsetWidth/Height.
    requestAnimationFrame(updateBounds);
  });

  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(updateBounds);
    ro.observe(containerEl);
    return () => ro.disconnect();
  });
</script>

<div
  class="map-container"
  class:dragging={isDragging}
  bind:this={containerEl}
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  role="application"
  aria-label="Dungeon map — scroll to zoom, middle-click drag to pan"
>
  <pre class="map" bind:this={mapEl} style="transform: translate({panX}px, {panY}px); --zoom: {zoom || 1};">{#each croppedMap.rows as row, ry}{@const realY = ry + (croppedMap.minRow ?? 0)}<span class="map-row">{#each row.split('') as char, cx}{@const realX = cx + croppedMap.minCol}<span
        class="map-cell"
        style={getCellStyle(char, realX, realY)}
        title={getTooltip(realX, realY)}
        onclick={() => connection.handleClick(realX, realY)}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') connection.handleClick(realX, realY); }}
        role="button"
        tabindex="-1"
      >{char}</span>{/each}</span>
{/each}</pre>
</div>

<style>
  .map-container {
    position: relative;
    flex: 1;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--panel-radius);
    overflow: hidden;
    min-height: 0;
    /* Prevent the browser from hijacking the wheel for its own scrolling. */
    overscroll-behavior: contain;
    /* Block the native middle-click autoscroll affordance. */
    touch-action: none;
  }

  .map-container.dragging,
  .map-container.dragging .map-cell {
    cursor: grabbing;
  }

  .map {
    position: absolute;
    top: 0;
    left: 0;
    font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
    /* font-size and line-height scale with --zoom so text gets
       re-rasterized crisply at any zoom level. A CSS transform: scale()
       would just stretch the already-rasterized bitmap. */
    font-size: calc(14px * var(--zoom, 1));
    line-height: 1.55;
    margin: 0;
    white-space: pre;
    user-select: none;
    will-change: transform;
  }

  .map-row {
    display: flex;
    min-height: 1.55em;
  }

  .map-cell {
    display: inline-flex;
    justify-content: center;
    width: calc(13px * var(--zoom, 1));
    font-size: calc(14px * var(--zoom, 1));
    cursor: pointer;
    transition: background-color 0.1s;
  }

  .map-cell:focus {
    outline: none;
  }

  .map-cell:hover {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
