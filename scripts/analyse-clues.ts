/**
 * Measures how well the current CLUE_SPEC discriminates.
 *
 *   npm run analyse:clues
 *
 * Run this after changing src/game/clueSpec.ts. It answers two questions:
 * how much does each column earn its place in the grid, and how hard is the
 * resulting game? Both are easy to get wrong by intuition -- the `setup` column
 * looked like a good clue and turned out to leave 89% of the pool standing.
 */
import { CLASSIC_POOL, FULL_POOL } from '../src/data/pools.js'
import { CLUE_SPEC } from '../src/game/clueSpec.js'
import { compare } from '../src/game/compare.js'
import type { Character } from '../src/game/types.js'

/** Distinct code per outcome. Note "match" and "miss" share a first letter. */
const CODE = { match: 'G', partial: 'Y', miss: '.' } as const

/** The clue row as a player perceives it: result plus any arrow. */
function signature(guess: Character, answer: Character, keys?: Set<string>): string {
  return compare(guess.attrs, answer.attrs)
    .filter((c) => !keys || keys.has(c.key))
    .map((c) => CODE[c.result] + (c.direction ?? ''))
    .join('|')
}

/** Expected number of candidates still standing after one guess. */
function cutsTo(pool: readonly Character[], keys?: Set<string>): number {
  const n = pool.length
  let remaining = 0
  for (const guess of pool) {
    const buckets = new Map<string, number>()
    for (const answer of pool) {
      const key = signature(guess, answer, keys)
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    for (const k of buckets.values()) remaining += (k / n) * k
  }
  return remaining / n
}

/**
 * Guesses an optimal solver needs, picking the guess that minimises the
 * worst-case surviving bucket each turn. This is an upper bound on difficulty:
 * a real player has no attribute table in front of them.
 */
function greedyDepth(pool: readonly Character[], answer: Character): number {
  let candidates = pool.slice()
  for (let turn = 1; turn <= 15; turn++) {
    let best = candidates[0]
    let bestWorst = Infinity
    // Once the field is small, only guessing a live candidate can win this turn.
    for (const g of candidates.length > 40 ? pool : candidates) {
      const buckets = new Map<string, number>()
      for (const a of candidates) {
        const key = signature(g, a)
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
      const worst = Math.max(...buckets.values())
      if (worst < bestWorst) {
        bestWorst = worst
        best = g
      }
    }
    if (best.id === answer.id) return turn
    const observed = signature(best, answer)
    candidates = candidates.filter((a) => a.id !== best.id && signature(best, a) === observed)
    if (candidates.length === 0) return turn + 1
  }
  return 99
}

for (const [label, pool] of [
  ['Daily Classic', CLASSIC_POOL],
  ['Daily Full', FULL_POOL],
] as const) {
  console.log(`\n=== ${label} (${pool.length} characters) ===`)

  const all = cutsTo(pool)
  console.log(`All ${CLUE_SPEC.length} columns: one guess leaves ${all.toFixed(2)} candidates (${((all / pool.length) * 100).toFixed(1)}%)\n`)

  const rows = CLUE_SPEC.map((col) => {
    const alone = cutsTo(pool, new Set([col.key]))
    const without = cutsTo(pool, new Set(CLUE_SPEC.filter((c) => c.key !== col.key).map((c) => c.key)))
    return {
      column: col.key,
      kind: col.kind,
      'alone leaves': alone.toFixed(1),
      'cost to drop': (without - all).toFixed(2),
    }
  })
  rows.sort((a, b) => parseFloat(b['cost to drop']) - parseFloat(a['cost to drop']))
  console.table(rows)

  const sample = pool.filter((_, i) => i % 3 === 0)
  const depths = sample.map((a) => greedyDepth(pool, a))
  const dist: Record<number, number> = {}
  depths.forEach((d) => (dist[d] = (dist[d] ?? 0) + 1))
  console.log(
    `Optimal play over ${sample.length} answers: average ${(depths.reduce((x, y) => x + y, 0) / depths.length).toFixed(2)} guesses, ` +
      `worst ${Math.max(...depths)}, distribution ${JSON.stringify(dist)}`,
  )
}
