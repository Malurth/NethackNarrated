export interface LLMEntry {
  kind: 'narration' | 'analysis';
  turn: number;
  text: string;
  timestamp: number;
  /** Context captured at narration time, used to render a compact header
   *  when this entry appears in future prompts' narration history.
   *  Optional so legacy entries from older persisted state still load. */
  header?: NarrationHeader;
}

/** Context anchoring a past narration entry in its game moment — turn,
 *  dungeon level, HP, active conditions, and the action that triggered it.
 *  Rendered as a compact one-line prefix in the narration history block,
 *  e.g. `[T142, dlvl 3, HP 12/18, hungry, flying] quaff potion d`. */
export interface NarrationHeader {
  dlvl: number;
  hp: number;
  maxHp: number;
  conditions: string[];
  properties: string[];
  action: string;
  /** Condensed summary of notable events covered by this narration
   *  (discoveries, identifications, pickups, combat, etc.). Rendered
   *  between the header line and the prose in the narration history so
   *  the LLM has structured memory of what it already narrated about. */
  events?: string[];
}
