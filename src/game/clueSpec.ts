import type { CharacterAttrs } from './types.js'

/**
 * THE single definition of the clue grid.
 *
 * Both comparators read this: the TypeScript one in compare.ts (used by Endless
 * and by every client-side preview) and the plpgsql one in supabase/functions.sql
 * (used by the dailies and PvP, where the answer must never reach the client).
 * The SQL side is seeded from this array, so adding or retuning a column means
 * editing this file and re-running the seed -- never hand-editing the SQL.
 *
 * Column choice is measured, not guessed. Against the 87-character Daily Classic
 * pool, leave-one-out cost of dropping each column (higher = more useful):
 *
 *   reminders 1.51 | team 0.92 | script 0.91 | jinxes 0.90
 *   tags 0.56 | nightOrder 0.51 | wake 0.33 | setup 0.06
 *
 * `setup` was cut on that evidence -- at 89% green it left the pool essentially
 * untouched. Its intuitive signal survives as the `setup-modifier` ability tag.
 * `jinxes` replaced it. Together these seven narrow 87 candidates to ~2.2 after
 * a single guess under perfect play.
 */

export type ClueKind = 'group' | 'exact' | 'numeric' | 'set'

/** Outcome of one clue cell. Rendered green / amber / grey respectively. */
export type ClueResult = 'match' | 'partial' | 'miss'

export interface ClueColumn {
  /** Key into CharacterAttrs. */
  key: keyof CharacterAttrs
  /** Column heading in the grid. */
  label: string
  /** Short heading for narrow viewports. */
  shortLabel: string
  kind: ClueKind
  /** group: which bucket each value belongs to; equal buckets give a partial. */
  groups?: Record<string, string>
  /** numeric: absolute difference at or below this yields a partial. */
  tolerance?: number
  /** numeric: null is a legal value (a character who never wakes night 1). */
  nullable?: boolean
}

/**
 * Alignment buckets for the Type column. Travellers are the only `other` team
 * in competitive play; fabled and loric appear solely behind the Endless
 * opt-in toggle, and are grouped with them so that toggle still clues correctly.
 */
export const ALIGNMENT_GROUPS: Record<string, string> = {
  townsfolk: 'good',
  outsider: 'good',
  minion: 'evil',
  demon: 'evil',
  traveller: 'other',
  fabled: 'other',
  loric: 'other',
}

export const CLUE_SPEC: readonly ClueColumn[] = [
  {
    key: 'team',
    label: 'Type',
    shortLabel: 'Type',
    kind: 'group',
    groups: ALIGNMENT_GROUPS,
  },
  { key: 'script', label: 'Script', shortLabel: 'Script', kind: 'exact' },
  { key: 'wake', label: 'Wakes', shortLabel: 'Wakes', kind: 'exact' },
  {
    key: 'nightOrder',
    label: 'Night order',
    shortLabel: 'Order',
    kind: 'numeric',
    tolerance: 3,
    nullable: true,
  },
  { key: 'tags', label: 'Ability', shortLabel: 'Ability', kind: 'set' },
  {
    key: 'reminders',
    label: 'Reminders',
    shortLabel: 'Rem.',
    kind: 'numeric',
    tolerance: 1,
  },
  { key: 'jinxes', label: 'Jinxes', shortLabel: 'Jinx', kind: 'numeric', tolerance: 1 },
] as const

/** Human-readable labels for enum-valued attributes, used by the grid and share text. */
export const VALUE_LABELS: Record<string, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsider',
  minion: 'Minion',
  demon: 'Demon',
  traveller: 'Traveller',
  fabled: 'Fabled',
  loric: 'Loric',
  tb: 'Trouble Brewing',
  bmr: 'Bad Moon Rising',
  snv: 'Sects & Violets',
  experimental: 'Experimental',
  never: 'Never',
  first: 'First night',
  other: 'Other nights',
  both: 'Both',
  good: 'Good',
  evil: 'Evil',
}
