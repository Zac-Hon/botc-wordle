import raw from './characters.json'
import type { Character } from '../game/types.js'

export const ALL_CHARACTERS = raw as unknown as Character[]

export const BY_ID: ReadonlyMap<string, Character> = new Map(
  ALL_CHARACTERS.map((c) => [c.id, c]),
)

/**
 * Answer pools, expressed as predicates over the build-time pool flags rather
 * than over edition strings. `carousel` is the official app's name for the
 * experimental pool, and two fabled characters (Deus ex Fiasco, Ferryman) ship
 * inside it -- so anything keyed off edition would leak them into the dailies.
 * isStoryteller is derived from TEAM, which is the only reliable signal.
 */
export const POOLS = {
  /** Daily Classic: Trouble Brewing, Bad Moon Rising, Sects & Violets, travellers included. */
  classic: (c: Character) => c.pools.inBase3,
  /** Daily Full: every player character. Fabled and Loric are excluded by design. */
  full: (c: Character) => !c.pools.isStoryteller,
} as const

export interface EndlessPoolOptions {
  base3: boolean
  experimental: boolean
  travellers: boolean
  /** Off by default: Fabled and Loric flatten two of the seven clue columns. */
  storyteller: boolean
}

export const DEFAULT_ENDLESS_POOL: EndlessPoolOptions = {
  base3: true,
  experimental: true,
  travellers: true,
  storyteller: false,
}

/** Builds the Endless answer pool from the player's toggles. */
export function endlessPool(opts: EndlessPoolOptions): Character[] {
  return ALL_CHARACTERS.filter((c) => {
    if (c.pools.isStoryteller) return opts.storyteller
    if (c.pools.isTraveller) return opts.travellers && (opts.base3 || opts.experimental)
    if (c.pools.inBase3) return opts.base3
    if (c.pools.isExperimental) return opts.experimental
    return false
  })
}

export const CLASSIC_POOL = ALL_CHARACTERS.filter(POOLS.classic)
export const FULL_POOL = ALL_CHARACTERS.filter(POOLS.full)
