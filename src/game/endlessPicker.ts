import type { Character } from './types'

const RECENT_KEY = 'botc-wordle:endless-recent'
/** How many past answers to avoid. Kept well below the smallest usable pool. */
const RECENT_LIMIT = 25

/**
 * Reads the recently-served Endless answers.
 *
 * localStorage can throw outright (private mode, blocked site data), so every
 * access is guarded -- a player with storage disabled should still get a game,
 * just without repeat avoidance.
 */
export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function rememberRecent(id: string): void {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_LIMIT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable; repeat avoidance is a nicety, not a requirement.
  }
}

/**
 * Picks a genuinely random Endless answer, avoiding the recent ones.
 *
 * Endless previously used a seeded PRNG keyed on a round counter that restarted
 * at zero every page load, so every session served the identical sequence of
 * characters -- which defeats the entire point of the mode. There is nothing to
 * protect here (the player can reroll freely), so real randomness is correct.
 *
 * The recent list is trimmed against the pool size so a small pool -- say
 * Travellers only -- cannot exclude everything and stall.
 */
export function pickEndless(pool: readonly Character[], recent: readonly string[]): Character | null {
  if (pool.length === 0) return null

  const avoid = new Set(recent.slice(0, Math.max(0, Math.min(recent.length, pool.length - 1))))
  const candidates = pool.filter((c) => !avoid.has(c.id))
  const from = candidates.length > 0 ? candidates : pool

  return from[Math.floor(Math.random() * from.length)]
}
