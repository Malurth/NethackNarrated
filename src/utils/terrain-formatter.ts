import type { TerrainSummary } from '../types/game';

function describeRelativePos(px: number, py: number, tx: number, ty: number): string {
  const dx = tx - px;
  const dy = ty - py;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return 'here';
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  const dir = `${ns}${ns && ew ? '-' : ''}${ew}`;
  if (dist === 1) return dir;
  return `${dist} tiles ${dir}`;
}

function describeRoomSize(width: number, height: number): string {
  const area = width * height;
  if (area <= 16) return 'small';
  if (area <= 50) return 'medium';
  if (area <= 120) return 'large';
  return 'vast';
}

/**
 * Format a TerrainSummary into compact natural language for LLM prompts.
 * Produces 2-5 sentences describing the player's surroundings.
 */
export function formatTerrainForPrompt(
  terrain: TerrainSummary,
  playerX: number,
  playerY: number,
): string {
  const parts: string[] = [];

  // 1. Where the player is
  if (terrain.playerRoom) {
    const r = terrain.playerRoom;
    const size = describeRoomSize(r.width, r.height);
    const lighting = r.lit ? 'lit' : 'dark';
    if (r.width > 15 || r.height > 12) {
      parts.push(`In a ${lighting} ${size} chamber.`);
    } else {
      parts.push(`In a ${lighting} ${size} room (${r.width}x${r.height}).`);
    }
  } else if (terrain.playerTerrain === 'CORR') {
    parts.push(terrain.playerLit ? 'In a lit corridor.' : 'In a dark corridor.');
  } else if (terrain.playerTerrain === 'DOOR') {
    parts.push('Standing in a doorway.');
  } else {
    parts.push(`On ${terrain.playerTerrain.toLowerCase()} terrain.`);
  }

  // 2. Exits
  if (terrain.exits.length > 0) {
    const exitDescs = terrain.exits
      .filter(e => e.direction !== 'here')
      .slice(0, 6)
      .map(e => {
        const prep = e.direction.includes('wall') ? 'on' : 'to the';
        return `${e.type} ${prep} ${e.direction}`;
      });
    if (exitDescs.length === 1) {
      parts.push(`Exit: ${exitDescs[0]}.`);
    } else if (exitDescs.length > 1) {
      parts.push(`Exits:\n${exitDescs.map(d => `- ${d}`).join('\n')}`);
    }
  }

  // 3. Features
  if (terrain.features.length > 0) {
    const featureDescs = terrain.features
      .filter(f => f.inSight)
      .slice(0, 6)
      .map(f => {
        const pos = describeRelativePos(playerX, playerY, f.x, f.y);
        return pos === 'here' ? `${f.name} here` : `${f.name} ${pos}`;
      });
    if (featureDescs.length === 1) {
      parts.push(`Feature: ${featureDescs[0]}.`);
    } else if (featureDescs.length > 1) {
      parts.push(`Features:\n${featureDescs.map(d => `- ${d}`).join('\n')}`);
    }
  }

  // 4. Nearby rooms
  if (terrain.nearbyRooms.length > 0) {
    const roomDescs = terrain.nearbyRooms
      .slice(0, 3)
      .map(r => {
        const lighting = r.lit ? 'lit' : 'dark';
        return `a ${lighting} room nearby`;
      });
    // Deduplicate similar descriptions
    const unique = [...new Set(roomDescs)];
    if (unique.length > 0) {
      parts.push(`Can see ${unique.join(' and ')}.`);
    }
  }

  // 5. Darkness
  if (terrain.darkLOSTiles > 5) {
    parts.push('Some areas within line-of-sight are dark.');
  }

  return parts.join('\n');
}
