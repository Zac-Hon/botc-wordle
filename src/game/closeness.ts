/**
 * Spelling tolerance for the PvP icon race.
 *
 * The round asks players to recognise token art and type the name fast, so a
 * near-miss should be told it is near without being told the answer -- the
 * player still has to produce the correct spelling themselves (skribbl-style).
 */

/** Strips case, accents, punctuation and spacing so "lil monsta" ~ "Lil' Monsta". */
export function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Standard Levenshtein distance, iterative with a single row of state. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr.slice()
  }
  return prev[b.length]
}

export type GuessVerdict = 'correct' | 'close' | 'wrong'

/**
 * Judges a typed name against the answer.
 *
 * The "close" band exists for typos, so it must never fire on a name that is
 * itself a real character. Butler and Butcher are two edits apart: without the
 * `knownNames` guard, typing Butler when the answer is Butcher would answer
 * "so close!", which both leaks information and is simply wrong -- the player
 * named a different character, they did not mistype this one.
 *
 * Pass every character name in the current pool as `knownNames`. Omitting it
 * only makes sense in unit tests of the raw distance behaviour.
 */
export function judgeName(
  input: string,
  answer: string,
  knownNames: Iterable<string> = [],
): GuessVerdict {
  const a = normalise(input)
  const b = normalise(answer)
  if (a.length === 0) return 'wrong'
  if (a === b) return 'correct'

  // Naming some other real character is a wrong answer, never a near-miss.
  for (const known of knownNames) {
    if (normalise(known) === a) return 'wrong'
  }

  const distance = levenshtein(a, b)
  const allowed = b.length <= 6 ? 1 : 2
  return distance <= allowed ? 'close' : 'wrong'
}
