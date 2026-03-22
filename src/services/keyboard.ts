/** Map keyboard keys to NethackServe action names */
export const KEY_TO_ACTION: Record<string, string> = {
  // Movement (vi keys)
  'k': 'move_north',
  'j': 'move_south',
  'l': 'move_east',
  'h': 'move_west',
  'u': 'move_northeast',
  'y': 'move_northwest',
  'n': 'move_southeast',
  'b': 'move_southwest',

  // Arrow keys
  'ArrowUp': 'move_north',
  'ArrowDown': 'move_south',
  'ArrowRight': 'move_east',
  'ArrowLeft': 'move_west',

  // Basic actions
  '.': 'wait',
  ',': 'pickup',
  '>': 'go_down',
  '<': 'go_up',
  ' ': 'more',
  's': 'search',
  'i': 'inventory',

  // Interaction
  'a': 'apply',
  'Z': 'cast',
  'c': 'close',
  'E': 'engrave',
  'f': 'fire',
  'o': 'open',

  // Inventory verbs (names match @neth4ck/api methods)
  'e': 'eat',
  'q': 'drink',
  'r': 'read',
  'z': 'zap',
  'W': 'wear',
  'w': 'wield',
  'P': 'putOn',
  'T': 'takeOff',
  'd': 'drop',
  't': 'throw',
  'Q': 'quiver',

  // Utility
  'x': 'swap',
  ':': 'look',
  '@': 'autopickup',
  'C': 'call',
  'p': 'pay',
  'R': 'remove',
  'X': 'twoweapon',
  'A': 'takeoffall',
  'D': 'droptype',
  'F': 'fight',

  // Escape
  'Escape': 'esc',
};

/** Actions that require an inventory letter to follow (verb:letter pattern) */
export const INVENTORY_VERB_ACTIONS = new Set([
  'drink', 'read', 'zap', 'wear', 'wield', 'putOn',
  'takeOff', 'eat', 'drop', 'throw', 'quiver',
]);

/**
 * Compute the move action for click-to-move given player and target positions.
 * Returns the action name or null if clicking on the player's own position.
 */
export function clickToMoveAction(
  playerX: number,
  playerY: number,
  targetX: number,
  targetY: number,
): string | null {
  const dx = Math.sign(targetX - playerX);
  const dy = Math.sign(targetY - playerY);

  if (dx === 0 && dy === 0) return null;

  const dirMap: Record<string, string> = {
    '0,-1': 'move_north',
    '0,1': 'move_south',
    '1,0': 'move_east',
    '-1,0': 'move_west',
    '1,-1': 'move_northeast',
    '-1,-1': 'move_northwest',
    '1,1': 'move_southeast',
    '-1,1': 'move_southwest',
  };

  return dirMap[`${dx},${dy}`] ?? null;
}
