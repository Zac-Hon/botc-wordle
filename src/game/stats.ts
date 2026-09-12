import { daysBetween } from './daily'

export interface SessionRow {
  mode: string
  puzzle_date: string | null
  guess_count: number
  solved: boolean
  is_archive: boolean
}

export interface ModeStats {
  played: number
  wins: number
  winRate: number
  currentStreak: number
  maxStreak: number
  averageGuesses: number | null
  /** Guess count -> how many wins took that many. Bucketed, with 9+ pooled. */
  distribution: Record<string, number>
}

export const DISTRIBUTION_BUCKETS = ['1', '2', '3', '4', '5', '6', '7', '8', '9+'] as const

function bucket(n: number): string {
  return n >= 9 ? '9+' : String(n)
}

/**
 * Computes streaks and distribution for one daily mode.
 *
 * Archive replays are excluded throughout: they are explicitly "games you
 * missed", so counting them would let a player manufacture a streak by working
 * backwards through the archive.
 *
 * A streak counts consecutive *calendar days* with a win. Today being unplayed
 * does not break the streak -- the day is not over yet -- but any earlier gap
 * does.
 */
export function computeStats(rows: SessionRow[], mode: string, today: string): ModeStats {
  const played = rows
    .filter((r) => r.mode === mode && !r.is_archive && r.puzzle_date)
    .sort((a, b) => (a.puzzle_date! < b.puzzle_date! ? 1 : -1)) // newest first

  const wins = played.filter((r) => r.solved)

  const distribution: Record<string, number> = {}
  for (const b of DISTRIBUTION_BUCKETS) distribution[b] = 0
  for (const w of wins) distribution[bucket(w.guess_count)]++

  const averageGuesses =
    wins.length > 0 ? wins.reduce((sum, w) => sum + w.guess_count, 0) / wins.length : null

  // Current streak: walk back from today across consecutive solved days.
  let currentStreak = 0
  let cursor = today
  const byDate = new Map(played.map((r) => [r.puzzle_date!, r]))

  // Today not yet played is not a broken streak, so start from yesterday then.
  if (!byDate.has(today)) {
    cursor = shiftDate(today, -1)
  }
  while (byDate.get(cursor)?.solved) {
    currentStreak++
    cursor = shiftDate(cursor, -1)
  }

  // Max streak: longest run of consecutive solved dates anywhere in history.
  let maxStreak = 0
  let run = 0
  let prevDate: string | null = null
  for (const r of [...played].reverse()) {
    if (!r.solved) {
      run = 0
      prevDate = r.puzzle_date
      continue
    }
    run = prevDate && daysBetween(prevDate, r.puzzle_date!) === 1 ? run + 1 : 1
    maxStreak = Math.max(maxStreak, run)
    prevDate = r.puzzle_date
  }

  return {
    played: played.length,
    wins: wins.length,
    winRate: played.length > 0 ? wins.length / played.length : 0,
    currentStreak,
    maxStreak: Math.max(maxStreak, currentStreak),
    averageGuesses,
    distribution,
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
