import { describe, it, expect } from 'vitest';
import { scanTerrain, type TerrainGameAPI, type BulkTerrainData } from './terrain-scanner';
import { MAP_WIDTH, MAP_HEIGHT } from '@neth4ck/api';

const TILE_COUNT = MAP_WIDTH * MAP_HEIGHT;

const VIS = 0x3; // COULD_SEE | IN_SIGHT
const LOS = 0x1; // COULD_SEE only (dark)

const LEVL_TYP_DEFAULT: Record<number, string> = {
  0: 'STONE', 1: 'VWALL', 2: 'HWALL',
  23: 'DOOR', 24: 'CORR', 25: 'ROOM',
  26: 'STAIRS', 28: 'FOUNTAIN', 32: 'ALTAR',
};

/** Build a BulkTerrainData object from a sparse tile map. */
function makeBulk(
  tiles: Record<string, { typ: string; lit: number; roomNo: number; vision: number }>,
  levlTyp: Record<number, string> = LEVL_TYP_DEFAULT,
): BulkTerrainData {
  const nameToInt = Object.fromEntries(Object.entries(levlTyp).map(([k, v]) => [v, Number(k)]));
  const colors = new Uint8Array(TILE_COUNT);
  const typs = new Uint8Array(TILE_COUNT);
  const visions = new Uint8Array(TILE_COUNT);
  const lits = new Uint8Array(TILE_COUNT);
  const roomNos = new Uint8Array(TILE_COUNT);
  let chars = '';
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      const t = tiles[`${x},${y}`];
      if (t) {
        typs[i] = nameToInt[t.typ] ?? 0;
        lits[i] = t.lit;
        roomNos[i] = t.roomNo;
        visions[i] = t.vision;
        chars += '.';
      } else {
        chars += ' ';
      }
    }
  }
  return { chars, colors, typs, visions, lits, roomNos };
}

/** Build a mock game API with the lookAt/terrainAt and stair direction shims.
 *
 * `lookAt` simulates the buggy behavior: a monster standing on a tile
 * returns the monster's name, masking the underlying terrain. Pass
 * `lookOverrides` to simulate that. `terrainAt` always returns the
 * actual terrain for a DOOR tile, independent of lookOverrides — this
 * mirrors the real C implementation which reads levl[x][y].typ+doormask
 * directly. */
function mockGame(
  tiles: Record<string, { typ: string; lit: number; roomNo: number; vision: number }>,
  levlTyp: Record<number, string> = LEVL_TYP_DEFAULT,
  lookOverrides: Record<string, string> = {},
): TerrainGameAPI {
  return {
    lookAt(x, y) {
      const key = `${x},${y}`;
      if (lookOverrides[key] !== undefined) return lookOverrides[key];
      const t = tiles[key];
      if (!t) return '';
      if (t.typ === 'DOOR') return 'doorway';
      return '';
    },
    terrainAt(x, y) {
      const t = tiles[`${x},${y}`];
      if (!t) return '';
      if (t.typ === 'DOOR') return 'doorway';
      return '';
    },
    constants: { LEVL_TYP: levlTyp },
  };
}

describe('scanTerrain', () => {
  it('detects player in a lit room with correct dimensions', () => {
    const tiles: Record<string, any> = {};
    for (let y = 9; y <= 11; y++) {
      for (let x = 9; x <= 11; x++) {
        tiles[`${x},${y}`] = { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS };
      }
    }
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.playerTerrain).toBe('ROOM');
    expect(result.playerLit).toBe(true);
    expect(result.playerRoom).not.toBeNull();
    expect(result.playerRoom!.roomNo).toBe(1);
    expect(result.playerRoom!.width).toBe(3);
    expect(result.playerRoom!.height).toBe(3);
    expect(result.playerRoom!.lit).toBe(true);
    expect(result.playerRoom!.tileCount).toBe(9);
  });

  it('detects player in a dark corridor', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'CORR', lit: 0, roomNo: 0, vision: VIS },
      '11,10': { typ: 'CORR', lit: 0, roomNo: 0, vision: VIS },
      '12,10': { typ: 'CORR', lit: 0, roomNo: 0, vision: VIS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.playerTerrain).toBe('CORR');
    expect(result.playerLit).toBe(false);
    expect(result.playerRoom).toBeNull();
    expect(result.visibleFloorTiles).toBe(3);
  });

  it('detects features (fountain, stairs, altar)', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '12,10': { typ: 'FOUNTAIN', lit: 1, roomNo: 1, vision: VIS },
      '10,8': { typ: 'STAIRS', lit: 1, roomNo: 1, vision: VIS },
      '14,10': { typ: 'ALTAR', lit: 1, roomNo: 1, vision: VIS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.features.length).toBe(3);
    const names = result.features.map(f => f.name).sort();
    expect(names).toEqual(['altar', 'fountain', 'staircase']);
  });

  it('resolves stair direction from visibleFeatures', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,8': { typ: 'STAIRS', lit: 1, roomNo: 1, vision: VIS },
      '12,10': { typ: 'STAIRS', lit: 1, roomNo: 1, vision: VIS },
    };
    const game = {
      ...mockGame(tiles),
      visibleFeatures: [
        { x: 10, y: 8, name: 'staircase up' },
        { x: 12, y: 10, name: 'staircase down' },
      ],
    };
    const result = scanTerrain(game, 10, 10, makeBulk(tiles));

    const stairNames = result.features.map(f => f.name).sort();
    expect(stairNames).toEqual(['staircase down', 'staircase up']);
  });

  it('falls back to base feature name when visibleFeatures unavailable', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,8': { typ: 'STAIRS', lit: 1, roomNo: 1, vision: VIS },
    };
    // No visibleFeatures on the game object
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    const names = result.features.map(f => f.name);
    expect(names).toEqual(['staircase']);
  });

  it('detects exits by checking adjacent room tiles for wall determination', () => {
    const tiles: Record<string, any> = {
      // 3x3 room (roomNo=1)
      '9,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '9,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '9,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      // Door on north wall
      '10,8': { typ: 'DOOR', lit: 1, roomNo: 0, vision: VIS },
      // Door on east wall
      '12,10': { typ: 'DOOR', lit: 1, roomNo: 0, vision: VIS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.exits.length).toBe(2);
    const walls = result.exits.map(e => e.direction).sort();
    expect(walls[0]).toContain('east wall');
    expect(walls[1]).toContain('north wall');
    expect(result.exits.every(e => e.type === 'doorway')).toBe(true);
  });

  it('reports door terrain type even when a monster stands on the tile', () => {
    // Regression: a grid bug standing on a doorway used to be reported as
    // "grid bug on east wall" in the exits list because we called lookAt,
    // which returns whatever glyph is on top. terrainAt must return the
    // underlying terrain feature regardless of what's on the tile.
    const tiles: Record<string, any> = {
      '9,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,9': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '9,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '9,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      // Door on east wall, with a grid bug standing on it
      '12,10': { typ: 'DOOR', lit: 1, roomNo: 0, vision: VIS },
    };
    // lookAt returns the monster for this tile — simulates the real WASM
    // bug where _get_screen_description describes whatever's on top.
    const game = mockGame(tiles, LEVL_TYP_DEFAULT, { '12,10': 'grid bug' });
    const result = scanTerrain(game, 10, 10, makeBulk(tiles));

    expect(result.exits.length).toBe(1);
    expect(result.exits[0].type).toBe('doorway');
    expect(result.exits[0].direction).toContain('east wall');
  });

  it('includes distance for exits far from the player', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,11': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,12': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,13': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '10,14': { typ: 'DOOR', lit: 1, roomNo: 0, vision: VIS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.exits.length).toBe(1);
    expect(result.exits[0].direction).toContain('south wall');
    expect(result.exits[0].direction).toContain('4 tiles away');
  });

  it('detects nearby rooms separate from player room', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '11,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '20,10': { typ: 'ROOM', lit: 0, roomNo: 2, vision: LOS },
      '21,10': { typ: 'ROOM', lit: 0, roomNo: 2, vision: LOS },
      '20,11': { typ: 'ROOM', lit: 0, roomNo: 2, vision: LOS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.playerRoom!.roomNo).toBe(1);
    expect(result.nearbyRooms.length).toBe(1);
    expect(result.nearbyRooms[0].roomNo).toBe(2);
    expect(result.nearbyRooms[0].lit).toBe(false);
  });

  it('counts dark line-of-sight tiles', () => {
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
      '15,10': { typ: 'CORR', lit: 0, roomNo: 0, vision: LOS },
      '16,10': { typ: 'CORR', lit: 0, roomNo: 0, vision: LOS },
    };
    const result = scanTerrain(mockGame(tiles), 10, 10, makeBulk(tiles));

    expect(result.darkLOSTiles).toBe(2);
  });

  it('returns empty terrain when constants unavailable', () => {
    const game: TerrainGameAPI = {
      lookAt: () => '',
      constants: null,
    };
    const empty: BulkTerrainData = {
      chars: '',
      colors: new Uint8Array(0),
      typs: new Uint8Array(0),
      visions: new Uint8Array(0),
      lits: new Uint8Array(0),
      roomNos: new Uint8Array(0),
    };
    const result = scanTerrain(game, 10, 10, empty);
    expect(result.playerTerrain).toBe('UNKNOWN');
    expect(result.playerRoom).toBeNull();
  });

  it('works with different LEVL_TYP values (version independence)', () => {
    // 3.6.7 has different enum values
    const LEVL_TYP_367: Record<number, string> = { 22: 'DOOR', 23: 'CORR', 24: 'ROOM', 25: 'STAIRS' };
    const tiles: Record<string, any> = {
      '10,10': { typ: 'ROOM', lit: 1, roomNo: 1, vision: VIS },
    };
    const result = scanTerrain(
      mockGame(tiles, LEVL_TYP_367),
      10,
      10,
      makeBulk(tiles, LEVL_TYP_367),
    );

    expect(result.playerTerrain).toBe('ROOM');
    expect(result.playerRoom).not.toBeNull();
  });
});
