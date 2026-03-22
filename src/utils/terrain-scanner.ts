import { MAP_WIDTH, MAP_HEIGHT, TERRAIN_TYPE_NAMES } from '@neth4ck/api';
import type { TerrainSummary, RoomInfo, TerrainFeature, TerrainExit } from '../types/game';

/** Pre-fetched per-tile terrain data from one bulk get_terrain_map() call. */
export interface BulkTerrainData {
  /** Terrain glyph chars, length = MAP_WIDTH * MAP_HEIGHT, row-major. */
  chars: string;
  /** NetHack color enum (0-15) per tile. */
  colors: Uint8Array;
  /** Terrain enum from levl[x][y].typ per tile. */
  typs: Uint8Array;
  /** Vision flags (COULD_SEE | IN_SIGHT | TEMP_LIT) per tile. */
  visions: Uint8Array;
  /** Lit status (1 or 0) per tile. */
  lits: Uint8Array;
  /** Room number (0-63) per tile. */
  roomNos: Uint8Array;
}

/** Minimal interface for the WASM game queries we need. */
export interface TerrainGameAPI {
  lookAt(x: number, y: number): string;
  /** Terrain-only description at (x, y) — ignores creatures/items standing on the tile.
   *  Returns strings like "closed door", "open door", "doorway", etc. */
  terrainAt?(x: number, y: number): string;
  constants: { LEVL_TYP?: Record<number, string> } | null;
  /** Pre-resolved features from the API (stairs already have direction in their name). */
  visibleFeatures?: { x: number; y: number; name: string }[];
}

const COULD_SEE = 0x1;
const IN_SIGHT = 0x2;

/** Terrain type names that represent room-like walkable floor. */
const ROOM_TYPES = new Set(['ROOM', 'STAIRS', 'LADDER', 'FOUNTAIN', 'THRONE', 'SINK', 'GRAVE', 'ALTAR', 'ICE']);

/** Terrain type names that are features worth reporting. */
const FEATURE_TYPES: Record<string, string> = TERRAIN_TYPE_NAMES as Record<string, string>;

function relativeDirection(px: number, py: number, tx: number, ty: number): string {
  const dx = tx - px;
  const dy = ty - py;
  if (dx === 0 && dy === 0) return 'here';
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  return `${ns}${ns && ew ? '' : ''}${ew}` || 'here';
}

/** Helper: index into bulk arrays for tile (x, y). */
function tileIdx(x: number, y: number): number {
  return y * MAP_WIDTH + x;
}

/**
 * Determine which wall a door is on by checking its cardinal neighbors.
 * If a room tile (matching playerRoomNo) is adjacent, the door is on
 * the opposite wall. E.g., room tile to the south of the door → north wall.
 */
function determineDoorWall(
  bulk: BulkTerrainData,
  doorX: number,
  doorY: number,
  playerRoomNo: number,
  levlTyp: Record<number, string>,
): string | null {
  // Cardinal directions: [dx, dy, wall name if room is in this direction]
  const checks: [number, number, string][] = [
    [0, 1, 'north wall'],   // room to south → door on north wall
    [0, -1, 'south wall'],  // room to north → door on south wall
    [1, 0, 'west wall'],    // room to east → door on west wall
    [-1, 0, 'east wall'],   // room to west → door on east wall
  ];
  for (const [dx, dy, wall] of checks) {
    const nx = doorX + dx;
    const ny = doorY + dy;
    if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
    const i = tileIdx(nx, ny);
    const typ = bulk.typs[i];
    if (!typ) continue;
    const name = levlTyp[typ];
    if (!name) continue;
    // Check if this neighbor is a room-type tile in the player's room
    if ((ROOM_TYPES.has(name) || name === 'DOOR') && playerRoomNo > 0) {
      if (bulk.roomNos[i] === playerRoomNo) return wall;
    }
  }
  return null;
}

/**
 * Scan the map using pre-fetched bulk terrain data and build a structured summary.
 * All per-tile data comes from one get_terrain_map() FFI call (bulk arg).
 * Stair/ladder direction is resolved from the API's visibleFeatures (no FFI needed).
 */
export function scanTerrain(
  game: TerrainGameAPI,
  playerX: number,
  playerY: number,
  bulk: BulkTerrainData,
): TerrainSummary {
  const levlTyp = game.constants?.LEVL_TYP;
  if (!levlTyp || !bulk.typs || bulk.typs.length === 0) {
    return emptyTerrain();
  }

  // Index API features by position for stair/ladder direction lookup
  const featureIndex = game.visibleFeatures
    ? new Map(game.visibleFeatures.map(f => [`${f.x},${f.y}`, f]))
    : null;

  // Read player's own tile from bulk
  const playerIdx = tileIdx(playerX, playerY);
  const playerTypInt = bulk.typs[playerIdx];
  const playerTerrain = levlTyp[playerTypInt] || 'UNKNOWN';
  const playerLitVal = bulk.lits[playerIdx];
  const playerRoomNo = bulk.roomNos[playerIdx];

  // Accumulators
  const roomTiles = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; count: number; litCount: number }>();
  const features: TerrainFeature[] = [];
  const doorTiles: { x: number; y: number; inSight: boolean }[] = [];
  let visibleFloorTiles = 0;
  let darkLOSTiles = 0;

  // Scan all tiles using bulk data — zero FFI calls in this loop
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = tileIdx(x, y);
      const vision = bulk.visions[i];
      if (!(vision & COULD_SEE)) continue;

      const typInt = bulk.typs[i];
      if (!typInt) continue;
      const typName = levlTyp[typInt];
      if (!typName) continue;

      const lit = bulk.lits[i];
      const roomNo = bulk.roomNos[i];
      const inSight = !!(vision & IN_SIGHT);

      // Count dark-but-LOS tiles
      if (!inSight) {
        darkLOSTiles++;
      }

      // Room tile bucketing
      if (ROOM_TYPES.has(typName) || typName === 'CORR') {
        visibleFloorTiles++;
        if (roomNo > 0) {
          const bucket = roomTiles.get(roomNo);
          if (bucket) {
            bucket.minX = Math.min(bucket.minX, x);
            bucket.maxX = Math.max(bucket.maxX, x);
            bucket.minY = Math.min(bucket.minY, y);
            bucket.maxY = Math.max(bucket.maxY, y);
            bucket.count++;
            if (lit === 1) bucket.litCount++;
          } else {
            roomTiles.set(roomNo, { minX: x, maxX: x, minY: y, maxY: y, count: 1, litCount: lit === 1 ? 1 : 0 });
          }
        }
      }

      // Feature detection
      let featureName = FEATURE_TYPES[typName];
      if (featureName) {
        // Resolve stair/ladder direction from the API's visibleFeatures
        // (the API already calls _get_stair_direction internally)
        if (typName === 'STAIRS' || typName === 'LADDER') {
          const apiFeature = featureIndex?.get(`${x},${y}`);
          if (apiFeature) {
            featureName = apiFeature.name;
          }
        }
        features.push({ name: featureName, x, y, inSight });
      }

      // Door collection
      if (typName === 'DOOR') {
        doorTiles.push({ x, y, inSight });
      }
    }
  }

  // Build player's room info
  let playerRoom: RoomInfo | null = null;
  if (playerRoomNo > 0 && roomTiles.has(playerRoomNo)) {
    const b = roomTiles.get(playerRoomNo)!;
    playerRoom = {
      roomNo: playerRoomNo,
      width: b.maxX - b.minX + 1,
      height: b.maxY - b.minY + 1,
      lit: b.litCount > b.count / 2,
      tileCount: b.count,
    };
  }

  // Build nearby rooms (excluding player's)
  const nearbyRooms: RoomInfo[] = [];
  for (const [roomNo, b] of roomTiles) {
    if (roomNo === playerRoomNo || roomNo <= 0) continue;
    nearbyRooms.push({
      roomNo,
      width: b.maxX - b.minX + 1,
      height: b.maxY - b.minY + 1,
      lit: b.litCount > b.count / 2,
      tileCount: b.count,
    });
  }

  // Build exits: only include doors/openings that are actually visible (IN_SIGHT).
  // Color comes from the bulk dump.
  const exits: TerrainExit[] = [];
  for (const d of doorTiles) {
    if (!d.inSight) continue;
    // Use terrainAt so a monster or object standing on the door doesn't
    // mask the actual terrain feature. Falls back to lookAt for older
    // WASM builds that don't export get_terrain_description.
    const desc = game.terrainAt ? game.terrainAt(d.x, d.y) : game.lookAt(d.x, d.y);
    const type = desc || 'opening';
    const wall = determineDoorWall(bulk, d.x, d.y, playerRoomNo, levlTyp);
    const dist = Math.max(Math.abs(d.x - playerX), Math.abs(d.y - playerY));
    const direction = wall
      ? (dist <= 1 ? `${wall}, adjacent` : `${wall}, ${dist} tiles away`)
      : relativeDirection(playerX, playerY, d.x, d.y);
    const color = bulk.colors[tileIdx(d.x, d.y)];
    exits.push({ x: d.x, y: d.y, direction, type, color });
  }

  // When in a corridor, add corridor continuations as exits.
  if (playerTerrain === 'CORR' || playerTerrain === 'DOOR') {
    for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const nx = playerX + dx;
      const ny = playerY + dy;
      if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
      const ni = tileIdx(nx, ny);
      const vis = bulk.visions[ni];
      if (!(vis & IN_SIGHT)) continue;
      const typ = bulk.typs[ni];
      if (!typ) continue;
      const name = levlTyp[typ];
      const color = bulk.colors[ni];
      if (name === 'CORR') {
        exits.push({ x: nx, y: ny, direction: relativeDirection(playerX, playerY, nx, ny), type: 'corridor', color });
      } else if (ROOM_TYPES.has(name)) {
        exits.push({ x: nx, y: ny, direction: relativeDirection(playerX, playerY, nx, ny), type: 'room opening', color });
      }
    }
  }

  return {
    playerTerrain,
    playerRoom,
    playerLit: playerLitVal === 1,
    nearbyRooms,
    features,
    exits,
    visibleFloorTiles,
    darkLOSTiles,
  };
}

function emptyTerrain(): TerrainSummary {
  return {
    playerTerrain: 'UNKNOWN',
    playerRoom: null,
    playerLit: false,
    nearbyRooms: [],
    features: [],
    exits: [],
    visibleFloorTiles: 0,
    darkLOSTiles: 0,
  };
}
