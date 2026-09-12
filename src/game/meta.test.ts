import { describe, expect, it } from 'vitest'
import { ALL_CHARACTERS } from '../data/pools'
import { buildShareText } from '../components/ShareButton'
import { computeStats, type SessionRow } from './stats'
import {
  PVP_GUESS_CAP,
  SPEED_REFERENCE_MS,
  scoreGuessRound,
  scoreIconRound,
} from './scoring'
import { compare } from './compare'
import type { GuessEntry } from '../components/GuessGrid'

const guess = (id: string, answerId: string): GuessEntry => {
  const g = ALL_CHARACTERS.find((c) => c.id === id)!
  const a = ALL_CHARACTERS.find((c) => c.id === answerId)!
  return { id: g.id, name: g.name, image: g.image, clue: compare(g.attrs, a.attrs) }
}

describe('share text', () => {
  const guesses = [guess('chef', 'baron'), guess('baron', 'baron')]

  it('reports the guess count and the date', () => {
    const text = buildShareText(
      { mode: 'Daily Classic', date: '2026-09-12', guesses, solved: true },
      'https://example.test',
    )
    expect(text).toContain('Clocktowerdle Classic · 2026-09-12')
    expect(text).toContain('2/∞')
    expect(text).toContain('https://example.test')
  })

  it('marks an unsolved game with X rather than a count', () => {
    const text = buildShareText({ mode: 'Daily Full', date: '2026-09-12', guesses, solved: false }, '')
    expect(text).toContain('X/∞')
  })

  it('omits the date for Endless, which has none', () => {
    const text = buildShareText({ mode: 'Endless', guesses, solved: true }, '')
    expect(text.split('\n')[0]).toBe('Clocktowerdle Endless')
  })

  it('flags an archive replay so a shared result is not mistaken for today', () => {
    const text = buildShareText(
      { mode: 'Daily Classic', date: '2026-01-01', guesses, solved: true, isArchive: true },
      '',
    )
    expect(text).toContain('(archive)')
  })

  /**
   * The whole purpose of the share grid is that it can be pasted into a channel
   * where people have not played. If a character name or an answer letter ever
   * leaks into it, the feature is actively harmful.
   */
  it('never leaks a character name', () => {
    const text = buildShareText(
      { mode: 'Daily Classic', date: '2026-09-12', guesses, solved: true },
      'https://example.test',
    )
    for (const c of ALL_CHARACTERS) {
      expect(text.toLowerCase()).not.toContain(c.name.toLowerCase())
    }
  })

  it('emits one emoji row per guess, one square per clue column', () => {
    const text = buildShareText({ mode: 'Endless', guesses, solved: true }, '')
    const rows = text.split('\n').filter((l) => /^[🟩🟨⬜]+$/u.test(l))
    expect(rows).toHaveLength(guesses.length)
    for (const r of rows) expect([...r]).toHaveLength(guesses[0].clue.length)
  })
})

describe('stats', () => {
  const row = (date: string, solved: boolean, guessCount = 3, isArchive = false): SessionRow => ({
    mode: 'classic',
    puzzle_date: date,
    guess_count: guessCount,
    solved,
    is_archive: isArchive,
  })

  it('counts played and wins', () => {
    const s = computeStats(
      [row('2026-09-10', true), row('2026-09-11', false), row('2026-09-12', true)],
      'classic',
      '2026-09-12',
    )
    expect(s.played).toBe(3)
    expect(s.wins).toBe(2)
    expect(s.winRate).toBeCloseTo(2 / 3)
  })

  it('counts a streak of consecutive solved days', () => {
    const s = computeStats(
      [row('2026-09-10', true), row('2026-09-11', true), row('2026-09-12', true)],
      'classic',
      '2026-09-12',
    )
    expect(s.currentStreak).toBe(3)
  })

  it('does not break the streak just because today is unplayed', () => {
    const s = computeStats([row('2026-09-10', true), row('2026-09-11', true)], 'classic', '2026-09-12')
    expect(s.currentStreak).toBe(2)
  })

  it('breaks the streak on a missed day', () => {
    const s = computeStats([row('2026-09-09', true), row('2026-09-11', true)], 'classic', '2026-09-12')
    expect(s.currentStreak).toBe(1)
  })

  it('breaks the streak on a loss', () => {
    const s = computeStats(
      [row('2026-09-10', true), row('2026-09-11', false), row('2026-09-12', true)],
      'classic',
      '2026-09-12',
    )
    expect(s.currentStreak).toBe(1)
  })

  it('remembers the best streak after it is broken', () => {
    const s = computeStats(
      [
        row('2026-09-01', true),
        row('2026-09-02', true),
        row('2026-09-03', true),
        row('2026-09-05', true),
      ],
      'classic',
      '2026-09-12',
    )
    expect(s.maxStreak).toBe(3)
    expect(s.currentStreak).toBe(0)
  })

  /**
   * Archive replays are explicitly "puzzles you missed". Counting them would let
   * anyone manufacture an unbroken streak by working backwards through history.
   */
  it('ignores archive replays entirely', () => {
    const s = computeStats(
      [row('2026-09-10', true, 3, true), row('2026-09-11', true, 3, true), row('2026-09-12', true)],
      'classic',
      '2026-09-12',
    )
    expect(s.played).toBe(1)
    expect(s.currentStreak).toBe(1)
  })

  /**
   * Reported as "classic and full stats are not actually separated". The core
   * computation was in fact correct; what looked broken was the standout-game
   * and per-set panels, which were not mode-filtered and so showed identical
   * numbers under both tabs. Pinning the core behaviour here regardless.
   */
  it('keeps every figure separate between the two dailies', () => {
    const rows: SessionRow[] = [
      { mode: 'classic', puzzle_date: '2026-09-10', guess_count: 2, solved: true, is_archive: false },
      { mode: 'classic', puzzle_date: '2026-09-11', guess_count: 4, solved: true, is_archive: false },
      { mode: 'full', puzzle_date: '2026-09-10', guess_count: 9, solved: true, is_archive: false },
      { mode: 'full', puzzle_date: '2026-09-11', guess_count: 7, solved: false, is_archive: false },
      { mode: 'endless', puzzle_date: null, guess_count: 1, solved: true, is_archive: false },
    ]
    const classic = computeStats(rows, 'classic', '2026-09-11')
    const full = computeStats(rows, 'full', '2026-09-11')

    expect(classic.played).toBe(2)
    expect(classic.wins).toBe(2)
    expect(classic.averageGuesses).toBe(3)
    expect(classic.currentStreak).toBe(2)

    expect(full.played).toBe(2)
    expect(full.wins).toBe(1)
    expect(full.averageGuesses).toBe(9)
    expect(full.currentStreak).toBe(0)

    // Endless has no puzzle_date and must not leak into either daily.
    expect(classic.played + full.played).toBe(4)
  })

  it('keeps modes separate', () => {
    const rows: SessionRow[] = [
      row('2026-09-12', true),
      { mode: 'full', puzzle_date: '2026-09-12', guess_count: 9, solved: true, is_archive: false },
    ]
    expect(computeStats(rows, 'classic', '2026-09-12').played).toBe(1)
    expect(computeStats(rows, 'full', '2026-09-12').played).toBe(1)
  })

  it('buckets nine or more guesses together', () => {
    const s = computeStats(
      [row('2026-09-11', true, 12), row('2026-09-12', true, 2)],
      'classic',
      '2026-09-12',
    )
    expect(s.distribution['9+']).toBe(1)
    expect(s.distribution['2']).toBe(1)
  })

  it('averages guesses over wins only', () => {
    const s = computeStats(
      [row('2026-09-11', true, 2), row('2026-09-12', false, 20)],
      'classic',
      '2026-09-12',
    )
    expect(s.averageGuesses).toBe(2)
  })

  it('handles a player with no history', () => {
    const s = computeStats([], 'classic', '2026-09-12')
    expect(s).toMatchObject({ played: 0, wins: 0, winRate: 0, currentStreak: 0, maxStreak: 0 })
    expect(s.averageGuesses).toBeNull()
  })
})

describe('pvp scoring weighs time', () => {
  const fast = 0
  const slow = SPEED_REFERENCE_MS

  it('pays more for the same guesses solved faster', () => {
    expect(scoreGuessRound(3, true, 1, fast)).toBeGreaterThan(scoreGuessRound(3, true, 1, slow))
  })

  it('pays more for fewer guesses at the same speed', () => {
    expect(scoreGuessRound(2, true, 1, 30_000)).toBeGreaterThan(
      scoreGuessRound(5, true, 1, 30_000),
    )
  })

  it('tops out at 100 and bottoms out at 30 for a solve', () => {
    expect(scoreGuessRound(1, true, 1, fast)).toBe(100)
    expect(scoreGuessRound(PVP_GUESS_CAP, true, 1, slow)).toBe(30)
  })

  /**
   * The complaint that prompted the reweight: individual seconds barely moved
   * the score. Twenty seconds should now be worth roughly ten points, which is
   * enough to decide a close round.
   */
  it('makes seconds matter', () => {
    const at10 = scoreGuessRound(3, true, 1, 10_000)
    const at30 = scoreGuessRound(3, true, 1, 30_000)
    expect(at10 - at30).toBeGreaterThanOrEqual(9)
  })

  it('gives speed a larger share than economy', () => {
    const perfect = scoreGuessRound(1, true, 1, fast)
    const lostAllSpeed = perfect - scoreGuessRound(1, true, 1, slow)
    const lostAllEconomy = perfect - scoreGuessRound(PVP_GUESS_CAP, true, 1, fast)
    expect(lostAllSpeed).toBeGreaterThan(lostAllEconomy)
  })

  /**
   * The invariant that matters: however slow and however wasteful, solving has
   * to beat not solving. Otherwise a player is better off stalling.
   */
  it('always pays a solve more than any failure', () => {
    const worstSolve = scoreGuessRound(PVP_GUESS_CAP, true, 1, SPEED_REFERENCE_MS * 10)
    const bestFailure = scoreGuessRound(1, false, 1, 0)
    expect(worstSolve).toBeGreaterThan(bestFailure)
  })

  it('decreases monotonically as the clock runs', () => {
    let prev = Infinity
    for (let t = 0; t <= SPEED_REFERENCE_MS * 1.5; t += 5_000) {
      const s = scoreGuessRound(4, true, 1, t)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })

  it('gives an unmeasured solve no speed bonus rather than a full one', () => {
    // Defaulting the other way would let a solve with a missing timestamp
    // outscore a genuinely fast one.
    expect(scoreGuessRound(4, true, 1)).toBe(scoreGuessRound(4, true, 1, SPEED_REFERENCE_MS))
  })

  it('still scores the icon round purely on speed, over a wider range', () => {
    expect(scoreIconRound(0)).toBe(100)
    expect(scoreIconRound(29_999)).toBe(25)
    expect(scoreIconRound(30_000)).toBe(0)
  })
})

/**
 * Ability tags are derived from official text by keyword rules, which makes
 * them vulnerable to negation: "(not yourself)" contains the word "yourself"
 * and means the opposite. That inverted eight characters, the Butler among
 * them, before it was noticed.
 */
describe('ability tags respect negation', () => {
  const negatesSelf = ALL_CHARACTERS.filter((c) =>
    /\((?:not|other than|except)\s+yourself/i.test(c.ability),
  )

  it('finds the characters whose ability excludes themselves', () => {
    expect(negatesSelf.length).toBeGreaterThan(5)
  })

  it('does not tag them self-targeting on the strength of that phrase alone', () => {
    // Some still qualify for a different reason: the Ogre chooses another
    // player but the effect ("you become their alignment") lands on itself.
    const wrong = negatesSelf.filter(
      (c) => c.attrs.tags.includes('self-targeting') && !/\byou become\b|\byou gain\b/i.test(c.ability),
    )
    expect(wrong.map((c) => c.name)).toEqual([])
  })

  it('keeps the Butler off the self-targeting list', () => {
    const butler = ALL_CHARACTERS.find((c) => c.id === 'butler')
    expect(butler?.attrs.tags).not.toContain('self-targeting')
  })

  it('still tags genuine self-reference, such as the Imp killing itself', () => {
    const imp = ALL_CHARACTERS.find((c) => c.id === 'imp')
    expect(imp?.attrs.tags).toContain('self-targeting')
  })
})
