/** Canonical team values from the official BOTC schema. */
export type Team =
  | 'townsfolk'
  | 'outsider'
  | 'minion'
  | 'demon'
  | 'traveller'
  | 'fabled'
  | 'loric'

/** Normalised script/edition bucket used by the `script` clue column. */
export type Script = 'tb' | 'bmr' | 'snv' | 'experimental' | 'fabled' | 'loric'

/** Three-way alignment grouping used for the amber "same side" clue. */
export type Alignment = 'good' | 'evil' | 'other'

/** When a character acts at night, derived from the official night sheets. */
export type Wake = 'never' | 'first' | 'other' | 'both'

export type AbilityTag =
  | 'information'
  | 'protection'
  | 'killing'
  | 'misinformation'
  | 'voting-social'
  | 'death-triggered'
  | 'self-targeting'
  | 'setup-modifier'
  | 'ability-granting'
  | 'rules-modifier'
  | 'no-ability'

/**
 * The attribute bag every clue column reads from. Keys here must stay in sync
 * with CLUE_SPEC; the SQL comparator is seeded from the same definitions.
 */
export interface CharacterAttrs {
  team: Team
  script: Script
  wake: Wake
  /** Position through the night, 1 (earliest) to 100 (latest); null if they never wake. */
  nightOrder: number | null
  tags: AbilityTag[]
  /** Reminder tokens, character-specific plus global. */
  reminders: number
  /** Jinxes shared with other characters (symmetric). */
  jinxes: number
}

/** Which answer pools a character may be drawn into. */
export interface PoolFlags {
  inBase3: boolean
  isExperimental: boolean
  isTraveller: boolean
  isStoryteller: boolean
}

export interface Character {
  id: string
  name: string
  ability: string
  flavor: string
  /** Path under /tokens, e.g. "washerwoman.webp". */
  image: string
  /** True when the character changes the setup, e.g. Baron's [+2 Outsiders].
   *  Shown on the reveal card; too rare (11% of characters) to earn a clue column. */
  affectsSetup: boolean
  attrs: CharacterAttrs
  pools: PoolFlags
}
