/**
 * Derives narration/analysis palette colors from a stored hue (0–360).
 *
 * From the hue we generate:
 * - text:       desaturated, ~60% lightness (readable on dark bg)
 * - border:     same hue, ~37% saturation, ~16% lightness (subtle left-border)
 * - background: fully saturated at 50% lightness, ~2% opacity (barely-visible tint)
 *
 * The color picker displays a mid-tone representative via `hueToHex`,
 * and `hexToHue` converts back when the user picks a new color.
 */

export interface DerivedPalette {
  text: string;
  border: string;
  background: string;
}

/** Default hues for narration (green ~130°) and analysis (yellow ~60°). */
export const DEFAULT_NARRATION_HUE = 130;
export const DEFAULT_ANALYSIS_HUE = 60;

/** Default intensities (0–200). 50 = muted, 100 = vivid, 200 = max. */
export const DEFAULT_NARRATION_INTENSITY = 50;
export const DEFAULT_ANALYSIS_INTENSITY = 100;

export function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  if (d === 0) return 0;

  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r1: number, g1: number, b1: number;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/** Convert a hue to a mid-tone hex for display in the color picker. */
export function hueToHex(hue: number): string {
  return hslToHex(hue, 0.50, 0.40);
}

/**
 * Derive the full palette from a hue (0–360) and intensity (0–100).
 * Intensity 0 = gray, 50 = current muted defaults, 100 = vivid.
 */
export function derivePalette(hue: number, intensity: number = 50): DerivedPalette {
  const t = intensity / 50; // 0 at intensity 0, 1 at 50, 2 at 100
  return {
    text: hslToHex(hue, Math.min(0.25 * t, 1), 0.60),
    border: hslToHex(hue, Math.min(0.37 * t, 1), 0.16),
    background: `hsla(${hue}, 100%, 50%, ${(0.02 * t).toFixed(3)})`,
  };
}
