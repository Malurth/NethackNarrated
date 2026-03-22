/** NLE terminal color codes (0-15) mapped to hex colors */
export const NLE_COLORS: Record<number, string> = {
  0: '#666677',  // CLR_BLACK (boosted for visibility on dark bg)
  1: '#cc3333',  // CLR_RED
  2: '#33bb33',  // CLR_GREEN
  3: '#cc8844',  // CLR_BROWN
  4: '#4466cc',  // CLR_BLUE
  5: '#cc44cc',  // CLR_MAGENTA
  6: '#44bbbb',  // CLR_CYAN
  7: '#bbbbbb',  // CLR_GRAY
  8: '#666677',  // NO_COLOR (boosted)
  9: '#ff6644',  // CLR_ORANGE
  10: '#66ff66', // CLR_BRIGHT_GREEN
  11: '#ffff44', // CLR_YELLOW
  12: '#6688ff', // CLR_BRIGHT_BLUE
  13: '#ff66ff', // CLR_BRIGHT_MAGENTA
  14: '#66ffff', // CLR_BRIGHT_CYAN
  15: '#ffffff', // CLR_WHITE
};

/** Default color for map characters without entity data */
export const DEFAULT_MAP_COLOR = '#445566';

/** Map character to default color for structural elements */
export function getStructuralColor(char: string): string {
  switch (char) {
    case '-': case '|': return '#1e2c3a';  // walls
    case '.': return '#141e28';            // floor
    case '#': return '#1e2c3a';            // corridor
    case '<': case '>': return '#4488ff';  // stairs
    case '+': return '#aa8855';            // door
    case '@': return '#00ff88';            // player
    case ' ': return 'transparent';
    default: return DEFAULT_MAP_COLOR;
  }
}
