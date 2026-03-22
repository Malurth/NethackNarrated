import { describe, it, expect } from 'vitest';
import { NLE_COLORS, DEFAULT_MAP_COLOR, getStructuralColor } from './colors';

describe('NLE_COLORS', () => {
  it('maps all 16 terminal color codes (0-15)', () => {
    for (let i = 0; i <= 15; i++) {
      expect(NLE_COLORS[i]).toBeDefined();
      expect(NLE_COLORS[i]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('returns expected colors for key entries', () => {
    expect(NLE_COLORS[1]).toBe('#cc3333');   // CLR_RED
    expect(NLE_COLORS[15]).toBe('#ffffff');   // CLR_WHITE
    expect(NLE_COLORS[11]).toBe('#ffff44');   // CLR_YELLOW
  });

  it('has no entries outside 0-15', () => {
    expect(Object.keys(NLE_COLORS).length).toBe(16);
  });
});

describe('getStructuralColor', () => {
  it('returns wall color for - and |', () => {
    expect(getStructuralColor('-')).toBe('#1e2c3a');
    expect(getStructuralColor('|')).toBe('#1e2c3a');
  });

  it('returns floor color for .', () => {
    expect(getStructuralColor('.')).toBe('#141e28');
  });

  it('returns corridor color for #', () => {
    expect(getStructuralColor('#')).toBe('#1e2c3a');
  });

  it('returns stairs color for < and >', () => {
    expect(getStructuralColor('<')).toBe('#4488ff');
    expect(getStructuralColor('>')).toBe('#4488ff');
  });

  it('returns door color for +', () => {
    expect(getStructuralColor('+')).toBe('#aa8855');
  });

  it('returns player color for @', () => {
    expect(getStructuralColor('@')).toBe('#00ff88');
  });

  it('returns transparent for space', () => {
    expect(getStructuralColor(' ')).toBe('transparent');
  });

  it('returns DEFAULT_MAP_COLOR for unrecognized chars', () => {
    expect(getStructuralColor('X')).toBe(DEFAULT_MAP_COLOR);
    expect(getStructuralColor('?')).toBe(DEFAULT_MAP_COLOR);
    expect(getStructuralColor('~')).toBe(DEFAULT_MAP_COLOR);
  });
});
