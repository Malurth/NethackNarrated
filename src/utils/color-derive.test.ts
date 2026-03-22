import { describe, it, expect } from 'vitest';
import { hexToHue, hueToHex, derivePalette, DEFAULT_NARRATION_HUE, DEFAULT_ANALYSIS_HUE, DEFAULT_NARRATION_INTENSITY, DEFAULT_ANALYSIS_INTENSITY } from './color-derive';

describe('hexToHue', () => {
  it('returns 0 for red', () => {
    expect(hexToHue('#ff0000')).toBe(0);
  });

  it('returns 120 for green', () => {
    expect(hexToHue('#00ff00')).toBe(120);
  });

  it('returns 240 for blue', () => {
    expect(hexToHue('#0000ff')).toBe(240);
  });

  it('returns 0 for grays (no saturation)', () => {
    expect(hexToHue('#808080')).toBe(0);
    expect(hexToHue('#000000')).toBe(0);
  });
});

describe('hueToHex', () => {
  it('produces a valid hex string', () => {
    expect(hueToHex(150)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('round-trips: hue → hex → hue preserves the hue', () => {
    for (const hue of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
      const hex = hueToHex(hue);
      expect(hexToHue(hex)).toBe(hue);
    }
  });
});

describe('derivePalette', () => {
  it('returns text, border, and background properties', () => {
    const palette = derivePalette(150);
    expect(palette).toHaveProperty('text');
    expect(palette).toHaveProperty('border');
    expect(palette).toHaveProperty('background');
  });

  it('uses default narration intensity when omitted', () => {
    const implicit = derivePalette(DEFAULT_NARRATION_HUE);
    const explicit = derivePalette(DEFAULT_NARRATION_HUE, DEFAULT_NARRATION_INTENSITY);
    expect(implicit).toEqual(explicit);
  });

  it('returns hex strings for text and border', () => {
    const palette = derivePalette(150);
    expect(palette.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.border).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns an hsla string for background', () => {
    const palette = derivePalette(150);
    expect(palette.background).toMatch(/^hsla\(150, 100%, 50%, [\d.]+\)$/);
  });

  it('produces a lighter text color than border color', () => {
    const palette = derivePalette(210);
    const textG = parseInt(palette.text.slice(3, 5), 16);
    const borderG = parseInt(palette.border.slice(3, 5), 16);
    expect(textG).toBeGreaterThan(borderG);
  });

  it('produces different palettes for narration vs analysis defaults', () => {
    const narration = derivePalette(DEFAULT_NARRATION_HUE);
    const analysis = derivePalette(DEFAULT_ANALYSIS_HUE);
    expect(narration.text).not.toBe(analysis.text);
    expect(narration.border).not.toBe(analysis.border);
  });

  it('intensity 0 produces fully desaturated (gray) text and border', () => {
    const palette = derivePalette(150, 0);
    // With 0 saturation, R=G=B, so all hex pairs should be equal
    const r = palette.text.slice(1, 3);
    const g = palette.text.slice(3, 5);
    const b = palette.text.slice(5, 7);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('higher intensity produces more saturated colors', () => {
    const low = derivePalette(150, 20);
    const high = derivePalette(150, 80);
    // For hue 150 (green), more saturation means lower red relative to green
    const lowR = parseInt(low.text.slice(1, 3), 16);
    const lowG = parseInt(low.text.slice(3, 5), 16);
    const highR = parseInt(high.text.slice(1, 3), 16);
    const highG = parseInt(high.text.slice(3, 5), 16);
    // Higher intensity = bigger gap between G and R
    expect(highG - highR).toBeGreaterThan(lowG - lowR);
  });

  it('intensity 100 does not exceed saturation of 1', () => {
    const palette = derivePalette(210, 100);
    // Should not throw or produce invalid hex
    expect(palette.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.border).toMatch(/^#[0-9a-f]{6}$/);
  });
});
