import { rngFrom } from './random.js'
import type { Character } from './types.js'

export type DailyMode = 'classic' | 'full'

/** Days a character is ineligible after being used as an answer for the same mode. */
export const NO_REPEAT_DAYS = 90

/** Salt so the two dailies never draw the same character on the same date. */
const MODE_SALT: Record<DailyMode, string> = {
  classic: 'botc-daily-classic',
  full: 'botc-daily-full',
}

/** Today's date in UTC as YYYY-MM-DD. The daily rolls over at 00:00 UTC. */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Days between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * Picks the answer for one date and mode.
 *
 * Deterministic: the same date, mode and pool always yield the same character,
 * which is what lets the seeding script and any client agree without
 * coordinating. `recent` carries the answers already assigned to earlier dates
 * for this mode so a character cannot recur inside NO_REPEAT_DAYS -- with only
 * 87 characters in the Classic pool, unseeded random selection would repeat
 * often enough to be noticed.
 *
 * If every candidate is blocked (a pool smaller than the window), the
 * exclusion is relaxed rather than failing: a repeat beats no puzzle.
 */
export function pickDaily(
  date: string,
  mode: DailyMode,
  pool: readonly Character[],
  recent: readonly { date: string; characterId: string }[] = [],
): Character {
  if (pool.length === 0) throw new Error(`Cannot pick a daily for ${date}: empty pool`)

  // The window cannot exceed the pool, or every character is eventually blocked
  // and the guarantee silently collapses into the fallback below. Classic has
  // only 87 characters, so its real window is 86 days rather than 90.
  const window = Math.min(NO_REPEAT_DAYS, pool.length - 1)

  const blocked = new Set(
    recent
      .filter((r) => {
        const age = daysBetween(r.date, date)
        return age > 0 && age <= window
      })
      .map((r) => r.characterId),
  )

  const eligible = pool.filter((c) => !blocked.has(c.id))
  const candidates = eligible.length > 0 ? eligible : pool

  const rand = rngFrom(`${MODE_SALT[mode]}:${date}`)
  return candidates[Math.floor(rand() * candidates.length)]
}
