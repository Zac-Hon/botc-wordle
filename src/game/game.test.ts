import { describe, expect, it } from 'vitest'
import { ALL_CHARACTERS, BY_ID, CLASSIC_POOL, FULL_POOL, endlessPool } from '../data/pools.js'
import { cellEmoji, compare, isSolved, matchFraction } from './compare.js'
import { CLUE_SPEC } from './clueSpec.js'
import { judgeName, levenshtein, normalise } from './closeness.js'
import { HANGMAN_START, hangmanToString, revealHangman } from './hangman.js'
import { NO_REPEAT_DAYS, daysBetween, pickDaily, todayUTC } from './daily.js'
import { ICON_ROUND_MS, PVP_GUESS_CAP, scoreGuessRound, scoreIconRound } from './scoring.js'
import { rngFrom, shuffle } from './random.js'
import type { CharacterAttrs } from './types.js'

const attrs = (over: Partial<CharacterAttrs> = {}): CharacterAttrs => ({
  team: 'townsfolk',
  script: 'tb',
  wake: 'first',
  nightOrder: 10,
  tags: ['information'],
  reminders: 2,
  jinxes: 0,
  ...over,
})

const cell = (row: ReturnType<typeof compare>, key: string) => {
  const c = row.find((x) => x.key === key)
  if (!c) throw new Error(`no cell for ${key}`)
  return c
}

describe('compare', () => {
  it('produces one cell per clue column, in spec order', () => {
    const row = compare(attrs(), attrs())
    expect(row.map((c) => c.key)).toEqual(CLUE_SPEC.map((c) => c.key))
  })

  it('marks an identical character solved', () => {
    expect(isSolved(compare(attrs(), attrs()))).toBe(true)
  })

  describe('group columns', () => {
    it('matches an identical team', () => {
      expect(cell(compare(attrs({ team: 'minion' }), attrs({ team: 'minion' })), 'team').result).toBe('match')
    })

    it('partially matches a different team on the same side', () => {
      expect(cell(compare(attrs({ team: 'minion' }), attrs({ team: 'demon' })), 'team').result).toBe('partial')
      expect(cell(compare(attrs({ team: 'townsfolk' }), attrs({ team: 'outsider' })), 'team').result).toBe('partial')
    })

    it('misses across alignments', () => {
      expect(cell(compare(attrs({ team: 'townsfolk' }), attrs({ team: 'demon' })), 'team').result).toBe('miss')
    })

    it('treats travellers as their own side', () => {
      expect(cell(compare(attrs({ team: 'traveller' }), attrs({ team: 'townsfolk' })), 'team').result).toBe('miss')
      expect(cell(compare(attrs({ team: 'traveller' }), attrs({ team: 'fabled' })), 'team').result).toBe('partial')
    })
  })

  describe('numeric columns', () => {
    it('points up when the answer is higher and down when lower', () => {
      expect(cell(compare(attrs({ reminders: 1 }), attrs({ reminders: 3 })), 'reminders').direction).toBe('up')
      expect(cell(compare(attrs({ reminders: 3 }), attrs({ reminders: 1 })), 'reminders').direction).toBe('down')
    })

    it('omits the arrow on an exact match', () => {
      expect(cell(compare(attrs({ reminders: 2 }), attrs({ reminders: 2 })), 'reminders').direction).toBeUndefined()
    })

    it('partially matches inside the tolerance and misses outside it', () => {
      expect(cell(compare(attrs({ reminders: 2 }), attrs({ reminders: 3 })), 'reminders').result).toBe('partial')
      expect(cell(compare(attrs({ reminders: 0 }), attrs({ reminders: 4 })), 'reminders').result).toBe('miss')
      // nightOrder runs on a 1-100 scale, so its tolerance is a wider 5
      expect(cell(compare(attrs({ nightOrder: 10 }), attrs({ nightOrder: 15 })), 'nightOrder').result).toBe('partial')
      expect(cell(compare(attrs({ nightOrder: 10 }), attrs({ nightOrder: 16 })), 'nightOrder').result).toBe('miss')
    })

    it('treats two non-waking characters as a match but gives no arrow', () => {
      const c = cell(compare(attrs({ nightOrder: null }), attrs({ nightOrder: null })), 'nightOrder')
      expect(c.result).toBe('match')
      expect(c.direction).toBeUndefined()
    })

    it('misses, without an arrow, when only one character wakes', () => {
      const c = cell(compare(attrs({ nightOrder: null }), attrs({ nightOrder: 5 })), 'nightOrder')
      expect(c.result).toBe('miss')
      expect(c.direction).toBeUndefined()
    })
  })

  describe('set column', () => {
    it('matches only an identical tag set', () => {
      expect(cell(compare(attrs({ tags: ['killing', 'information'] }), attrs({ tags: ['information', 'killing'] })), 'tags').result).toBe('match')
    })

    it('partially matches on any overlap', () => {
      expect(cell(compare(attrs({ tags: ['killing', 'information'] }), attrs({ tags: ['killing'] })), 'tags').result).toBe('partial')
    })

    it('does not treat a subset as a full match', () => {
      expect(cell(compare(attrs({ tags: ['killing'] }), attrs({ tags: ['killing', 'protection'] })), 'tags').result).toBe('partial')
    })

    it('misses with no shared tags', () => {
      expect(cell(compare(attrs({ tags: ['killing'] }), attrs({ tags: ['protection'] })), 'tags').result).toBe('miss')
    })
  })

  it('is symmetric in result, though not in arrow direction', () => {
    for (const a of ALL_CHARACTERS.slice(0, 40)) {
      for (const b of ALL_CHARACTERS.slice(0, 40)) {
        const ab = compare(a.attrs, b.attrs).map((c) => c.result)
        const ba = compare(b.attrs, a.attrs).map((c) => c.result)
        expect(ab).toEqual(ba)
      }
    }
  })

  it('scores matchFraction between 0 and 1, hitting 1 only on a solve', () => {
    expect(matchFraction(compare(attrs(), attrs()))).toBe(1)
    const f = matchFraction(compare(attrs({ team: 'demon', script: 'snv', wake: 'never', nightOrder: null, tags: ['protection'], reminders: 9, jinxes: 9 }), attrs()))
    expect(f).toBeGreaterThanOrEqual(0)
    expect(f).toBeLessThan(1)
  })

  it('maps results to share-grid emoji', () => {
    expect(cellEmoji('match')).toBe('🟩')
    expect(cellEmoji('partial')).toBe('🟨')
    expect(cellEmoji('miss')).toBe('⬜')
  })
})

describe('hangman', () => {
  it('stays hidden until the threshold', () => {
    for (let w = 0; w < HANGMAN_START; w++) {
      expect(revealHangman('Washerwoman', w, 'seed').active).toBe(false)
    }
    expect(revealHangman('Washerwoman', HANGMAN_START, 'seed').active).toBe(true)
  })

  it('reveals nothing at the threshold itself, only the shape', () => {
    const s = revealHangman('Washerwoman', HANGMAN_START, 'seed')
    expect(s.revealedCount).toBe(0)
    expect(hangmanToString(s)).toBe('___________')
  })

  it('reveals exactly one more letter per wrong guess', () => {
    for (let extra = 0; extra <= 11; extra++) {
      const s = revealHangman('Washerwoman', HANGMAN_START + extra, 'seed')
      expect(s.revealedCount).toBe(Math.min(extra, s.letterCount))
    }
  })

  it('never un-reveals a letter as the count grows', () => {
    let prev = revealHangman('Fortune Teller', HANGMAN_START, 'seed')
    for (let extra = 1; extra <= 14; extra++) {
      const next = revealHangman('Fortune Teller', HANGMAN_START + extra, 'seed')
      prev.slots.forEach((slot, i) => {
        if (slot.revealed) expect(next.slots[i].revealed).toBe(true)
      })
      prev = next
    }
  })

  it('shows spaces and punctuation for free, without spending a reveal', () => {
    const s = revealHangman("Lil' Monsta", HANGMAN_START, 'seed')
    expect(hangmanToString(s)).toBe("___' ______")
    expect(s.letterCount).toBe(9)
  })

  it('is identical for the same seed and divergent for different seeds', () => {
    const a = revealHangman('Washerwoman', 8, 'day-1')
    const b = revealHangman('Washerwoman', 8, 'day-1')
    expect(hangmanToString(a)).toBe(hangmanToString(b))

    const seeds = new Set(
      Array.from({ length: 20 }, (_, i) => hangmanToString(revealHangman('Washerwoman', 8, `day-${i}`))),
    )
    expect(seeds.size).toBeGreaterThan(1)
  })

  it('fully reveals the name once every letter is spent', () => {
    const s = revealHangman('Imp', HANGMAN_START + 3, 'seed')
    expect(hangmanToString(s)).toBe('Imp')
    expect(s.nextRevealIn).toBeNull()
  })

  it('counts down to the first reveal before it is active', () => {
    expect(revealHangman('Imp', 0, 's').nextRevealIn).toBe(HANGMAN_START)
    expect(revealHangman('Imp', 3, 's').nextRevealIn).toBe(1)
  })

  it('handles every real character name', () => {
    for (const c of ALL_CHARACTERS) {
      const s = revealHangman(c.name, HANGMAN_START + 200, `x:${c.id}`)
      expect(hangmanToString(s)).toBe(c.name)
    }
  })
})

describe('closeness', () => {
  it('normalises case, punctuation and accents', () => {
    expect(normalise("Lil' Monsta")).toBe('lilmonsta')
    expect(normalise('Al-Hadikhia')).toBe('alhadikhia')
    expect(normalise('  PIT-hag ')).toBe('pithag')
  })

  it('computes Levenshtein distance', () => {
    expect(levenshtein('imp', 'imp')).toBe(0)
    expect(levenshtein('imp', 'ump')).toBe(1)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })

  it('accepts a correct name regardless of formatting', () => {
    expect(judgeName("lil monsta", "Lil' Monsta")).toBe('correct')
    expect(judgeName('  WASHERWOMAN ', 'Washerwoman')).toBe('correct')
  })

  it('calls a typo close without confirming it', () => {
    expect(judgeName('washerwomen', 'Washerwoman')).toBe('close')
    expect(judgeName('fortuneteler', 'Fortune Teller')).toBe('close')
  })

  it('rejects an unrelated name', () => {
    expect(judgeName('imp', 'Washerwoman')).toBe('wrong')
    expect(judgeName('', 'Imp')).toBe('wrong')
  })

  it('is stricter for short names, where one edit reaches a different word', () => {
    expect(judgeName('ump', 'Imp')).toBe('close')
    expect(judgeName('umpp', 'Imp')).toBe('wrong')
  })

  /**
   * If two real characters sit inside the "close" band, typing one of them when
   * the other is the answer would tell the player they were nearly right. That
   * both leaks information and is unfair, so no such pair may exist.
   */
  it('never reports one real character as a near-miss for another', () => {
    const names = ALL_CHARACTERS.map((c) => c.name)
    const collisions: string[] = []
    for (const a of ALL_CHARACTERS) {
      for (const b of ALL_CHARACTERS) {
        if (a.id === b.id) continue
        if (judgeName(a.name, b.name, names) !== 'wrong') collisions.push(`${a.name} ~ ${b.name}`)
      }
    }
    expect(collisions).toEqual([])
  })

  it('still forgives a typo that is not itself a character name', () => {
    const names = ALL_CHARACTERS.map((c) => c.name)
    expect(judgeName('butcherr', 'Butcher', names)).toBe('close')
    // Butler and Butcher are two edits apart, so only the guard separates them.
    expect(judgeName('Butler', 'Butcher', names)).toBe('wrong')
  })
})

describe('scoring', () => {
  it('pays the ceiling for instant recognition and the floor at the buzzer', () => {
    expect(scoreIconRound(0)).toBe(100)
    expect(scoreIconRound(ICON_ROUND_MS - 1)).toBe(25)
  })

  it('pays nothing once the round has expired', () => {
    expect(scoreIconRound(ICON_ROUND_MS)).toBe(0)
    expect(scoreIconRound(ICON_ROUND_MS + 5000)).toBe(0)
  })

  it('decreases monotonically with elapsed time', () => {
    let prev = Infinity
    for (let t = 0; t < ICON_ROUND_MS; t += 500) {
      const s = scoreIconRound(t)
      expect(s).toBeLessThanOrEqual(prev)
      prev = s
    }
  })

  it('pays most for a one-guess instant solve and least for a slow capped one', () => {
    expect(scoreGuessRound(1, true, 1, 0)).toBe(100)
    expect(scoreGuessRound(PVP_GUESS_CAP, true, 1, 120_000)).toBe(30)
  })

  it('treats an omitted elapsed time as no speed bonus', () => {
    // 30 floor + 25 for a one-guess solve + 0 speed.
    expect(scoreGuessRound(1, true, 1)).toBe(55)
  })

  it('still pays the closest player when nobody solves, regardless of clock', () => {
    expect(scoreGuessRound(8, false, 1, 0)).toBe(25)
    expect(scoreGuessRound(8, false, 0.5, 0)).toBe(13)
    expect(scoreGuessRound(8, false, 0, 0)).toBe(0)
  })

  it('always rewards solving over not solving', () => {
    expect(scoreGuessRound(PVP_GUESS_CAP, true, 0, 999_999)).toBeGreaterThan(
      scoreGuessRound(1, false, 1, 0),
    )
  })
})

describe('daily selection', () => {
  it('is deterministic for a date and mode', () => {
    const a = pickDaily('2026-01-15', 'classic', CLASSIC_POOL)
    const b = pickDaily('2026-01-15', 'classic', CLASSIC_POOL)
    expect(a.id).toBe(b.id)
  })

  it('gives the two modes different answers on the same date', () => {
    const differing = Array.from({ length: 60 }, (_, i) => {
      const date = `2026-03-${String((i % 28) + 1).padStart(2, '0')}`
      return pickDaily(date, 'classic', CLASSIC_POOL).id !== pickDaily(date, 'full', FULL_POOL).id
    }).filter(Boolean).length
    expect(differing).toBeGreaterThan(50)
  })

  it('never repeats a character inside the no-repeat window', () => {
    const history: { date: string; characterId: string }[] = []
    const start = Date.parse('2026-01-01T00:00:00Z')
    for (let d = 0; d < 300; d++) {
      const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10)
      const pick = pickDaily(date, 'classic', CLASSIC_POOL, history)
      const window = Math.min(NO_REPEAT_DAYS, CLASSIC_POOL.length - 1)
      const recent = history.filter((h) => daysBetween(h.date, date) <= window)
      expect(recent.map((h) => h.characterId)).not.toContain(pick.id)
      history.push({ date, characterId: pick.id })
    }
  })

  it('draws only from the requested pool', () => {
    for (let d = 0; d < 120; d++) {
      const date = new Date(Date.parse('2026-06-01T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10)
      expect(pickDaily(date, 'classic', CLASSIC_POOL).pools.inBase3).toBe(true)
      expect(pickDaily(date, 'full', FULL_POOL).pools.isStoryteller).toBe(false)
    }
  })

  it('falls back to a repeat rather than failing on a pool smaller than the window', () => {
    const tiny = CLASSIC_POOL.slice(0, 2)
    const history = tiny.map((c, i) => ({ date: `2026-01-0${i + 1}`, characterId: c.id }))
    expect(() => pickDaily('2026-01-05', 'classic', tiny, history)).not.toThrow()
  })

  it('throws on an empty pool rather than returning undefined', () => {
    expect(() => pickDaily('2026-01-01', 'classic', [])).toThrow()
  })

  it('reports today in UTC', () => {
    expect(todayUTC(new Date('2026-05-04T23:59:59Z'))).toBe('2026-05-04')
    expect(todayUTC(new Date('2026-05-05T00:00:00Z'))).toBe('2026-05-05')
  })

  it('counts days between dates across a month boundary', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59)
  })
})

describe('random', () => {
  it('is reproducible from a seed', () => {
    const a = Array.from({ length: 5 }, rngFrom('x'))
    const b = Array.from({ length: 5 }, rngFrom('x'))
    expect(a).toEqual(b)
  })

  it('shuffles without losing or duplicating items', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const out = shuffle(items, rngFrom('seed'))
    expect(out).toHaveLength(50)
    expect([...out].sort((x, y) => x - y)).toEqual(items)
    expect(out).not.toEqual(items)
  })
})

describe('character data', () => {
  it('loads the expected pools', () => {
    expect(ALL_CHARACTERS.length).toBeGreaterThan(150)
    expect(CLASSIC_POOL.length).toBeGreaterThan(50)
    expect(FULL_POOL.length).toBeGreaterThan(CLASSIC_POOL.length)
  })

  it('keeps fabled and loric out of every competitive pool', () => {
    expect(CLASSIC_POOL.filter((c) => c.pools.isStoryteller)).toEqual([])
    expect(FULL_POOL.filter((c) => c.pools.isStoryteller)).toEqual([])
    expect(FULL_POOL.some((c) => c.attrs.team === 'fabled' || c.attrs.team === 'loric')).toBe(false)
  })

  it('includes travellers in both dailies', () => {
    expect(CLASSIC_POOL.some((c) => c.pools.isTraveller)).toBe(true)
    expect(FULL_POOL.some((c) => c.pools.isTraveller)).toBe(true)
  })

  it('only admits storyteller characters to Endless when opted in', () => {
    const off = endlessPool({ base3: true, experimental: true, travellers: true, storyteller: false })
    const on = endlessPool({ base3: true, experimental: true, travellers: true, storyteller: true })
    expect(off.some((c) => c.pools.isStoryteller)).toBe(false)
    expect(on.some((c) => c.pools.isStoryteller)).toBe(true)
  })

  it('gives every character unique ids, art and a full attribute set', () => {
    expect(new Set(ALL_CHARACTERS.map((c) => c.id)).size).toBe(ALL_CHARACTERS.length)
    for (const c of ALL_CHARACTERS) {
      expect(c.name, c.id).toBeTruthy()
      expect(c.image, c.id).toBe(`${c.id}.webp`)
      expect(c.attrs.tags.length, c.id).toBeGreaterThan(0)
      expect(c.attrs.reminders, c.id).toBeGreaterThanOrEqual(0)
      expect(c.attrs.jinxes, c.id).toBeGreaterThanOrEqual(0)
      expect(BY_ID.get(c.id)).toBe(c)
    }
  })

  it('leaves no player character tagged no-ability', () => {
    const untagged = FULL_POOL.filter((c) => c.attrs.tags.includes('no-ability'))
    expect(untagged.map((c) => c.name)).toEqual([])
  })

  /**
   * Every character who wakes at all has a position, on either night sheet.
   * This once only consulted the first-night sheet, so the 44 characters who
   * act solely on later nights reported no order and the grid showed them as
   * N/A. The Oracle, which wakes every night after the first, was the example
   * that surfaced it.
   */
  it('gives a night order to every character that wakes, and none that do not', () => {
    for (const c of ALL_CHARACTERS) {
      const wakes = c.attrs.wake !== 'never'
      expect(c.attrs.nightOrder !== null, `${c.name} wake=${c.attrs.wake}`).toBe(wakes)
    }
  })

  it('keeps night order on a comparable 1 to 100 scale', () => {
    // Two sheets of different lengths feed this column, so a raw position would
    // mean different things depending on which sheet a character came from.
    for (const c of ALL_CHARACTERS) {
      if (c.attrs.nightOrder === null) continue
      expect(Number.isInteger(c.attrs.nightOrder), c.name).toBe(true)
      expect(c.attrs.nightOrder, c.name).toBeGreaterThanOrEqual(1)
      expect(c.attrs.nightOrder, c.name).toBeLessThanOrEqual(100)
    }
  })

  it('places the Oracle late in the night rather than nowhere', () => {
    const oracle = ALL_CHARACTERS.find((c) => c.id === 'oracle')
    expect(oracle?.attrs.wake).toBe('other')
    expect(oracle?.attrs.nightOrder).not.toBeNull()
    expect(oracle?.attrs.nightOrder).toBeGreaterThan(50)
  })
})
