import type { CollectionEntry } from './useCollection'
import type { Character } from './types'

/**
 * How completely a character has been earned.
 *
 *   none      never named
 *   owned     named, but not the best way it can be named
 *   ringed    the gold ring: a daily for player characters, Endless for the
 *             Fabled and Loric the dailies never serve (see 11_storyteller_tier)
 *   mastered  named in all three modes
 *
 * The ringed rule is deliberately left exactly as it was. Players have already
 * earned those rings under a stated meaning, and quietly redefining it would
 * rewrite what they own. Mastery is added on top instead.
 */
export type CollectionTier = 'none' | 'owned' | 'ringed' | 'mastered'

/**
 * Whether mastery is reachable at all for this character.
 *
 * Fabled and Loric appear in no daily and are never offered by pvp_pick_character,
 * so two of the three flags can never be set for them. Treating a single Endless
 * win as mastery would hand out the top tier for the least work, so they are
 * excluded from mastery entirely and counted separately.
 */
export function canMaster(character: Character): boolean {
  return !character.pools.isStoryteller
}

export function collectionTier(
  character: Character,
  entry: CollectionEntry | undefined,
): CollectionTier {
  if (!entry) return 'none'
  if (canMaster(character) && entry.earned_daily && entry.earned_endless && entry.earned_pvp) {
    return 'mastered'
  }
  if (entry.earned_daily) return 'ringed'
  return 'owned'
}

/** Which modes are still missing, for the tooltip on a character you own. */
export function missingModes(
  character: Character,
  entry: CollectionEntry | undefined,
): ('Daily' | 'Endless' | 'Versus')[] {
  if (!entry || !canMaster(character)) return []
  const missing: ('Daily' | 'Endless' | 'Versus')[] = []
  if (!entry.earned_daily) missing.push('Daily')
  if (!entry.earned_endless) missing.push('Endless')
  if (!entry.earned_pvp) missing.push('Versus')
  return missing
}
