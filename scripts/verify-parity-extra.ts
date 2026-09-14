/**
 * Parity checks for logic that lives in both TypeScript and SQL but where only
 * the SQL copy runs.
 *
 *   npm run verify:parity   (runs this after the main checks)
 *
 * An audit found judgeName and matchFraction were never called by the app: the
 * icon round and the unsolved-round scoring both resolve server side. Their
 * TypeScript tests, including the one proving "Butler" must not be called close
 * to "Butcher", were protecting code nothing used. Rather than delete them,
 * this holds the live SQL to the TypeScript's behaviour, so those tests start
 * guarding something real.
 */
import { createClient } from '@supabase/supabase-js'
import { ALL_CHARACTERS } from '../src/data/pools.js'
import { compare, matchFraction } from '../src/game/compare.js'
import { judgeName } from '../src/game/closeness.js'
import { HANGMAN_START } from '../src/game/hangman.js'
import { rngFrom } from '../src/game/random.js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const supabase = createClient(url, key)
const NAMES = ALL_CHARACTERS.map((c) => c.name)
let mismatches = 0

function report(what: string, expected: unknown, actual: unknown) {
  mismatches++
  if (mismatches <= 10) console.error(`  ${what}: typescript ${expected}, postgres ${actual}`)
}

// --- The hangman threshold, written out in seven places on the SQL side ------
{
  const { data, error } = await supabase.rpc('hangman_start')
  if (error) {
    console.error('hangman_start failed:', error.message)
    process.exit(1)
  }
  if (Number(data) !== HANGMAN_START) report('hangman_start', HANGMAN_START, Number(data))
}

// --- Name judging -------------------------------------------------------------
console.log('Checking the icon-round spelling judge ...')

const cases: [string, string][] = [
  // Exact, and formatting the player should not be punished for.
  ['Washerwoman', 'Washerwoman'],
  ['  washerwoman ', 'Washerwoman'],
  ["lil monsta", "Lil' Monsta"],
  ['al-hadikhia', 'Al-Hadikhia'],
  // Typos that should be forgiven.
  ['washerwomen', 'Washerwoman'],
  ['fortuneteler', 'Fortune Teller'],
  ['butcherr', 'Butcher'],
  // The collision that must never be called close.
  ['Butler', 'Butcher'],
  ['Butcher', 'Butler'],
  // Short names, where one edit reaches a different word.
  ['ump', 'Imp'],
  ['umpp', 'Imp'],
  // Nothing at all.
  ['', 'Imp'],
  ['   ', 'Imp'],
]

// Plus a deterministic sweep of real pairs, which is where a collision would
// hide if one ever appeared in future character data.
const rand = rngFrom('judge-parity')
for (let i = 0; i < 400; i++) {
  const a = ALL_CHARACTERS[Math.floor(rand() * ALL_CHARACTERS.length)]
  const b = ALL_CHARACTERS[Math.floor(rand() * ALL_CHARACTERS.length)]
  cases.push([a.name, b.name])
}

for (const [input, answer] of cases) {
  const { data, error } = await supabase.rpc('pvp_judge_name', {
    p_input: input,
    p_answer: answer,
  })
  if (error) {
    console.error('pvp_judge_name failed:', error.message)
    process.exit(1)
  }
  const expected = judgeName(input, answer, NAMES)
  if (data !== expected) report(`judge("${input}" vs "${answer}")`, expected, data)
}

// --- Best match fraction ------------------------------------------------------
console.log('Checking unsolved-round scoring ...')

const rand2 = rngFrom('fraction-parity')
for (let i = 0; i < 200; i++) {
  const answer = ALL_CHARACTERS[Math.floor(rand2() * ALL_CHARACTERS.length)]
  const guesses = Array.from({ length: 1 + Math.floor(rand2() * 4) }, () => {
    const g = ALL_CHARACTERS[Math.floor(rand2() * ALL_CHARACTERS.length)]
    return { id: g.id, name: g.name, clue: compare(g.attrs, answer.attrs) }
  })

  const { data, error } = await supabase.rpc('pvp_best_fraction', { p_guesses: guesses })
  if (error) {
    console.error('pvp_best_fraction failed:', error.message)
    process.exit(1)
  }
  const expected = Math.max(...guesses.map((g) => matchFraction(g.clue)))
  if (Math.abs(Number(data) - expected) > 1e-6) {
    report(`best_fraction(${guesses.length} guesses vs ${answer.name})`, expected, Number(data))
  }
}

if (mismatches > 0) {
  console.error(`FAILED: ${mismatches} disagreement(s).`)
  process.exit(1)
}
console.log('OK: spelling judge, unsolved scoring and the hangman threshold all agree.')
