import { describe, it, expect } from 'vitest';
import { formatTerrainForPrompt } from './terrain-formatter';
import type { TerrainSummary } from '../types/game';

function baseTerrain(overrides: Partial<TerrainSummary> = {}): TerrainSummary {
  return {
    playerTerrain: 'ROOM',
    playerRoom: { roomNo: 1, width: 8, height: 5, lit: true, tileCount: 40 },
    playerLit: true,
    nearbyRooms: [],
    features: [],
    exits: [],
    visibleFloorTiles: 40,
    darkLOSTiles: 0,
    ...overrides,
  };
}

describe('formatTerrainForPrompt', () => {
  it('describes a lit room with dimensions', () => {
    const text = formatTerrainForPrompt(baseTerrain(), 10, 10);
    expect(text).toContain('lit');
    expect(text).toContain('8x5');
    expect(text).toContain('room');
  });

  it('describes a dark corridor', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      playerTerrain: 'CORR',
      playerRoom: null,
      playerLit: false,
    }), 10, 10);
    expect(text).toContain('dark');
    expect(text).toContain('corridor');
  });

  it('lists exits with directions', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      exits: [
        { x: 10, y: 8, direction: 'north', type: 'door', color: 7 },
        { x: 12, y: 10, direction: 'east', type: 'door', color: 7 },
      ],
    }), 10, 10);
    expect(text).toContain('Exits');
    expect(text).toContain('north');
    expect(text).toContain('east');
  });

  it('lists features with positions', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      features: [
        { name: 'fountain', x: 12, y: 10, inSight: true },
        { name: 'staircase', x: 10, y: 7, inSight: true },
      ],
    }), 10, 10);
    expect(text).toContain('fountain');
    expect(text).toContain('staircase');
  });

  it('uses "large chamber" for big rooms', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      playerRoom: { roomNo: 1, width: 20, height: 15, lit: true, tileCount: 300 },
    }), 10, 10);
    expect(text).toContain('chamber');
    expect(text).not.toContain('20x15');
  });

  it('mentions dark areas when present', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      darkLOSTiles: 10,
    }), 10, 10);
    expect(text).toContain('dark');
  });

  it('mentions nearby rooms', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      nearbyRooms: [{ roomNo: 2, width: 6, height: 4, lit: false, tileCount: 24 }],
    }), 10, 10);
    expect(text).toContain('room nearby');
  });

  it('only includes in-sight features', () => {
    const text = formatTerrainForPrompt(baseTerrain({
      features: [
        { name: 'fountain', x: 12, y: 10, inSight: false },
      ],
    }), 10, 10);
    expect(text).not.toContain('fountain');
  });
});
