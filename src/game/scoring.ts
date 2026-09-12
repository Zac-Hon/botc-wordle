/**
 * PvP scoring.
 *
 * Every round is worth the same headline value; what separates the players is
 * the scalar. Nothing escalates by round or by cycle, so a player who falls
 * behind early can still take the match on the last round.
 *
 * Both speed and economy count in every round. The icon race is pure speed
 * because there is nothing else to measure. The deduction rounds weigh guesses
 * and speed equally: they used to score on guesses alone, which meant three
 * guesses in twenty seconds paid exactly the same as three guesses in four
 * minutes, and the clock may as well not have been running.
 */

/** Wall-clock budget for the icon-recognition round. */
export const ICON_ROUND_MS = 30_000
/** Guess cap for the two deduction rounds. */
export const PVP_GUESS_CAP = 8

const ICON_FLOOR = 25
const CEILING = 100

/**
 * Floor for a solve in a deduction round.
 *
 * It sits above UNSOLVED_CEILING on purpose: solving must never pay less than
 * failing, however slow or expensive the solve was. Lowering the floor is what
 * buys room for the speed range below.
 */
const SOLVED_FLOOR = 30
/** Most a player can earn without solving, scaled by how close they got. */
const UNSOLVED_CEILING = 25

/** Points available for economy of guesses. */
const GUESS_WEIGHT = 25
/**
 * Points available for speed, now the largest single component.
 *
 * With 45 points spread across a 90 second window, a second is worth half a
 * point, so twenty seconds of hesitation costs ten. The earlier settings put
 * 25 points across 120 seconds, barely a fifth of a point a second, which is
 * why the clock made so little difference to the final score.
 */
const SPEED_WEIGHT = 45

/**
 * Speed stops earning anything past this point.
 *
 * The round itself runs for five minutes, but scaling against that would make
 * the bonus meaningless: almost every solve lands inside the first minute, so
 * everyone would sit at the top of the curve and the bonus would separate
 * nobody. Ninety seconds keeps the points concentrated where real solves
 * actually land, which is what makes individual seconds worth something.
 */
export const SPEED_REFERENCE_MS = 90_000

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Points for naming the character from its token art.
 *
 * Linear from 100 at instant recognition down to 25 as the clock runs out, so
 * recognising a token instantly is worth four times recognising it at the
 * buzzer. Both players can score; there is no winner-takes-all.
 */
export function scoreIconRound(elapsedMs: number): number {
  if (elapsedMs >= ICON_ROUND_MS) return 0
  const remaining = clamp01((ICON_ROUND_MS - Math.max(elapsedMs, 0)) / ICON_ROUND_MS)
  return Math.round(ICON_FLOOR + (CEILING - ICON_FLOOR) * remaining)
}

/** How much of the guess allowance a solve left unspent, from 1 down to 0. */
export function guessEfficiency(guesses: number): number {
  const used = Math.max(1, Math.min(guesses, PVP_GUESS_CAP))
  return (PVP_GUESS_CAP - used) / (PVP_GUESS_CAP - 1)
}

/** How much of the speed window a solve left unspent, from 1 down to 0. */
export function speedFactor(elapsedMs: number): number {
  return clamp01(1 - Math.max(0, elapsedMs) / SPEED_REFERENCE_MS)
}

/**
 * Points for a deduction round.
 *
 * A solve pays SOLVED_FLOOR plus up to GUESS_WEIGHT for economy and up to
 * SPEED_WEIGHT for speed, so a first-guess instant solve is 100 and a slow
 * eight-guess solve is 30. Speed carries the largest share deliberately: the
 * clock should decide close rounds. If nobody solves it, the closest guess
 * still earns something scaled by how much of the clue row they matched, to a
 * maximum of UNSOLVED_CEILING, so a round nobody wins is not a dead round.
 */
export function scoreGuessRound(
  guesses: number,
  solved: boolean,
  bestMatchFraction: number,
  elapsedMs = SPEED_REFERENCE_MS,
): number {
  if (!solved) return Math.round(UNSOLVED_CEILING * clamp01(bestMatchFraction))
  return Math.round(
    SOLVED_FLOOR + GUESS_WEIGHT * guessEfficiency(guesses) + SPEED_WEIGHT * speedFactor(elapsedMs),
  )
}
