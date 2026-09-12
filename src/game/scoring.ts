/**
 * PvP scoring.
 *
 * Every round is worth the same headline value; what separates the players is
 * the scalar. Round 1 rewards speed, rounds 2 and 3 reward economy of guesses.
 * Nothing here escalates by round or by cycle -- a player who falls behind early
 * can still take the match on the last round.
 */

/** Wall-clock budget for the icon-recognition round. */
export const ICON_ROUND_MS = 30_000
/** Guess cap for the two deduction rounds. */
export const PVP_GUESS_CAP = 8

const FLOOR = 40
const CEILING = 100
/**
 * Points lost per extra guess. Chosen so that solving at the cap (100 - 7*7 = 51)
 * still beats the best possible unsolved score (FLOOR = 40): a player who solves
 * must never score below one who does not.
 */
const GUESS_PENALTY = 7

/**
 * Points for naming the character from its token art.
 *
 * Linear from 100 at instant recognition down to 40 as the clock runs out, so
 * being first is worth roughly two and a half times being last-but-correct.
 * Both players can score; there is no winner-takes-all.
 */
export function scoreIconRound(elapsedMs: number): number {
  if (elapsedMs >= ICON_ROUND_MS) return 0
  const remaining = Math.max(0, ICON_ROUND_MS - elapsedMs) / ICON_ROUND_MS
  return Math.round(FLOOR + (CEILING - FLOOR) * remaining)
}

/**
 * Points for a deduction round.
 *
 * A first-guess solve is worth 100, falling to 51 at the eight-guess cap. If
 * nobody solves it, the closest guess still earns something -- scaled by how
 * much of the clue row they had matched, to a maximum of 40 -- so a round
 * nobody wins is not a dead round, while any solve still outscores any failure.
 */
export function scoreGuessRound(
  guesses: number,
  solved: boolean,
  bestMatchFraction: number,
): number {
  if (solved) return CEILING - (Math.max(1, guesses) - 1) * GUESS_PENALTY
  return Math.round(FLOOR * Math.max(0, Math.min(1, bestMatchFraction)))
}
