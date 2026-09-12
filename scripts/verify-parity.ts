/**
 * Proves the TypeScript and plpgsql comparators agree.
 *
 *   npm run verify:parity
 *
 * The clue logic exists twice -- src/game/compare.ts for Endless, and
 * botc_compare() in the database for the dailies and PvP, where the answer must
 * never reach the client. Both are generic engines driven by the same clue_spec
 * rows, but "driven by the same spec" is not the same as "behaves identically".
 * This runs thousands of real character pairs through both and demands
 * byte-identical output.
 *
 * Needs only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY: botc_compare takes
 * both sides as arguments, so it reveals nothing and no secret is required.
 */
import { createClient } from '@supabase/supabase-js'
import { ALL_CHARACTERS } from '../src/data/pools.js'
import { compare } from '../src/game/compare.js'
import { rngFrom } from '../src/game/random.js'
import {
  ICON_ROUND_MS,
  PVP_GUESS_CAP,
  SPEED_REFERENCE_MS,
  scoreGuessRound,
  scoreIconRound,
} from '../src/game/scoring.js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).')
  process.exit(1)
}

const PAIRS = Number(process.argv[2] ?? 5000)
const BATCH = 250

/** jsonb sorts keys, so compare on a canonical ordering rather than on text. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

const supabase = createClient(url, key)

// Deterministic pair selection so a failure is reproducible.
const rand = rngFrom('parity')
const pick = () => ALL_CHARACTERS[Math.floor(rand() * ALL_CHARACTERS.length)]

const pairs = Array.from({ length: PAIRS }, () => {
  const guess = pick()
  const answer = pick()
  return { guess, answer }
})

// Every character against itself, and a full sweep of one against all, to make
// sure the edge cases are covered rather than left to chance.
for (const c of ALL_CHARACTERS) pairs.push({ guess: c, answer: c })
for (const c of ALL_CHARACTERS) pairs.push({ guess: ALL_CHARACTERS[0], answer: c })

console.log(`Checking ${pairs.length} pairs against ${url} ...`)

let mismatches = 0
for (let i = 0; i < pairs.length; i += BATCH) {
  const slice = pairs.slice(i, i + BATCH)
  const { data, error } = await supabase.rpc('botc_compare_batch', {
    p_pairs: slice.map((p) => ({ guess: p.guess.attrs, answer: p.answer.attrs })),
  })

  if (error) {
    console.error('RPC failed:', error.message)
    console.error('Did you run supabase/02_functions.sql and seed/characters.sql?')
    process.exit(1)
  }

  const rows = data as unknown[]
  slice.forEach((pair, j) => {
    const expected = canonical(compare(pair.guess.attrs, pair.answer.attrs))
    const actual = canonical(rows[j])
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches++
      if (mismatches <= 5) {
        console.error(`\nMISMATCH  guess=${pair.guess.name}  answer=${pair.answer.name}`)
        console.error('  typescript:', JSON.stringify(expected))
        console.error('  postgres:  ', JSON.stringify(actual))
      }
    }
  })
  process.stdout.write(`\r  ${Math.min(i + BATCH, pairs.length)}/${pairs.length}`)
}

console.log()
if (mismatches > 0) {
  console.error(`FAILED: ${mismatches} of ${pairs.length} pairs disagree.`)
  process.exit(1)
}
console.log(`OK: all ${pairs.length} pairs agree between TypeScript and Postgres.`)

// ---------------------------------------------------------------------------
// PvP scoring. Duplicated in SQL for the same reason as the comparator -- the
// server must decide points -- so it carries the same drift risk.
// ---------------------------------------------------------------------------
console.log('Checking PvP scoring ...')
let scoreMismatches = 0

for (let ms = 0; ms <= ICON_ROUND_MS + 5000; ms += 250) {
  const { data, error } = await supabase.rpc('pvp_score_icon', { p_elapsed_ms: ms })
  if (error) {
    console.error('pvp_score_icon failed:', error.message)
    process.exit(1)
  }
  const expected = scoreIconRound(ms)
  if (Number(data) !== expected) {
    scoreMismatches++
    if (scoreMismatches <= 5) {
      console.error(`  icon ${ms}ms: typescript ${expected}, postgres ${Number(data)}`)
    }
  }
}

const ELAPSED_CASES = [
  0,
  5_000,
  30_000,
  60_000,
  SPEED_REFERENCE_MS - 1,
  SPEED_REFERENCE_MS,
  SPEED_REFERENCE_MS * 2,
]

for (let g = 1; g <= PVP_GUESS_CAP; g++) {
  for (const solved of [true, false]) {
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      for (const elapsed of ELAPSED_CASES) {
        const { data, error } = await supabase.rpc('pvp_score_guesses', {
          p_guesses: g,
          p_solved: solved,
          p_best_fraction: frac,
          p_elapsed_ms: elapsed,
        })
        if (error) {
          console.error('pvp_score_guesses failed:', error.message)
          process.exit(1)
        }
        const expected = scoreGuessRound(g, solved, frac, elapsed)
        if (Number(data) !== expected) {
          scoreMismatches++
          if (scoreMismatches <= 5) {
            console.error(
              `  guesses=${g} solved=${solved} frac=${frac} elapsed=${elapsed}: ` +
                `typescript ${expected}, postgres ${Number(data)}`,
            )
          }
        }
      }
    }
  }
}

if (scoreMismatches > 0) {
  console.error(`FAILED: ${scoreMismatches} scoring disagreements.`)
  process.exit(1)
}
console.log('OK: PvP scoring agrees between TypeScript and Postgres.')

// ---------------------------------------------------------------------------
// Elo. This one lives only in SQL, because ratings are settled server side and
// a client implementation would be dead code. The expectations below are a
// reference implementation written for the test alone: they exist to catch a
// typo in the plpgsql, not to be used by the app.
// ---------------------------------------------------------------------------
console.log('Checking Elo ...')
let eloMismatches = 0

const expectedScore = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400))
const expectedK = (games: number, rating: number) =>
  games < 10 ? 40 : rating >= 2000 ? 10 : 20

for (const [a, b] of [
  [1000, 1000],
  [1200, 1000],
  [1000, 1200],
  [1600, 800],
  [800, 1600],
  [2400, 2400],
] as const) {
  const { data, error } = await supabase.rpc('elo_expected', { p_a: a, p_b: b })
  if (error) {
    console.error('elo_expected failed:', error.message)
    process.exit(1)
  }
  const diff = Math.abs(Number(data) - expectedScore(a, b))
  if (diff > 1e-6) {
    eloMismatches++
    console.error(`  elo_expected(${a}, ${b}): typescript ${expectedScore(a, b)}, postgres ${Number(data)}`)
  }
}

for (const games of [0, 5, 9, 10, 50]) {
  for (const rating of [800, 1000, 1999, 2000, 2400]) {
    const { data, error } = await supabase.rpc('elo_k', { p_games: games, p_rating: rating })
    if (error) {
      console.error('elo_k failed:', error.message)
      process.exit(1)
    }
    if (Number(data) !== expectedK(games, rating)) {
      eloMismatches++
      console.error(`  elo_k(${games}, ${rating}): expected ${expectedK(games, rating)}, got ${Number(data)}`)
    }
  }
}

// A rating system that is not zero sum quietly inflates or drains the ladder.
{
  const { data } = await supabase.rpc('elo_expected', { p_a: 1200, p_b: 1000 })
  const ea = Number(data)
  const { data: data2 } = await supabase.rpc('elo_expected', { p_a: 1000, p_b: 1200 })
  const eb = Number(data2)
  if (Math.abs(ea + eb - 1) > 1e-6) {
    eloMismatches++
    console.error(`  expectations do not sum to 1: ${ea} + ${eb}`)
  }
}

if (eloMismatches > 0) {
  console.error(`FAILED: ${eloMismatches} Elo disagreements.`)
  process.exit(1)
}
console.log('OK: Elo behaves as specified.')
