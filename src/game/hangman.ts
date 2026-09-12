import { rngFrom, shuffle } from './random.js'

/** Wrong guesses required before the name starts showing at all. */
export const HANGMAN_START = 4

export interface HangmanSlot {
  /** The character at this position in the name. */
  char: string
  /** Whether the player can currently see it. */
  revealed: boolean
  /** Punctuation and spaces are structural: always shown, never "revealed". */
  structural: boolean
}

export interface HangmanState {
  /** False until the player has made HANGMAN_START wrong guesses. */
  active: boolean
  slots: HangmanSlot[]
  /** How many letters are currently uncovered. */
  revealedCount: number
  /** How many letters the name has in total. */
  letterCount: number
  /** Wrong guesses still needed before the next letter appears; null once fully revealed. */
  nextRevealIn: number | null
}

const isLetter = (ch: string) => /\p{L}|\p{N}/u.test(ch)

/**
 * Builds the hangman display for a name after a given number of wrong guesses.
 *
 * Nothing shows until HANGMAN_START wrong guesses; at exactly that point the
 * player sees the shape of the name (blanks plus any spaces and punctuation),
 * and each further wrong guess uncovers one more letter.
 *
 * The reveal order is seeded so that every player working on the same puzzle
 * uncovers the same letters in the same order -- otherwise the shareable result
 * grid would not describe a common experience.
 *
 * Spaces, apostrophes and hyphens are structural: they are always visible and
 * never consume a reveal, so "Lil' Monsta" does not waste two of the player's
 * hard-won letters on an apostrophe and a space.
 */
export function revealHangman(name: string, wrongGuesses: number, seed: string): HangmanState {
  const chars = [...name]
  const letterIndices = chars.map((c, i) => (isLetter(c) ? i : -1)).filter((i) => i >= 0)
  const letterCount = letterIndices.length

  const active = wrongGuesses >= HANGMAN_START
  const toReveal = Math.max(0, Math.min(wrongGuesses - HANGMAN_START, letterCount))

  // Seeded order, but the reveal is a prefix of it, so the sequence is stable
  // as the count grows: a letter shown at 6 wrong is still shown at 7.
  const order = shuffle(letterIndices, rngFrom(`${seed}:hangman`))
  const revealed = new Set(order.slice(0, toReveal))

  const slots = chars.map((char, i): HangmanSlot => {
    const structural = !isLetter(char)
    return {
      char,
      structural,
      revealed: structural || (active && revealed.has(i)),
    }
  })

  return {
    active,
    slots,
    revealedCount: toReveal,
    letterCount,
    nextRevealIn: toReveal >= letterCount ? null : active ? 1 : HANGMAN_START - wrongGuesses,
  }
}

/** Renders the state as text, e.g. "_ a _ _ e r w _ m a n". Used by tests and the share grid. */
export function hangmanToString(state: HangmanState): string {
  if (!state.active) return ''
  return state.slots.map((s) => (s.revealed ? s.char : '_')).join('')
}
