import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { GuessGrid, type GuessEntry } from './GuessGrid'
import { GuessInput } from './GuessInput'
import { HangmanBar } from './HangmanBar'
import type { HangmanState } from '../game/hangman'
import type { Character } from '../game/types'

/**
 * Room reserved beneath the input so its dropdown always has somewhere to open.
 *
 * The input sits UNDER the grid on purpose: when it was above, the suggestion
 * list opened downward across the very guesses you were consulting. But simply
 * moving it down is not enough -- as the last element on the page it would have
 * no space below it, and MUI would flip the list back up over the grid. This
 * padding guarantees downward room, and GuessInput disables the flip.
 */
const DROPDOWN_ROOM = 300

export function PlayArea({
  pool,
  guesses,
  guessedIds,
  hangman,
  finished,
  disabled,
  onGuess,
  emptyHint,
}: {
  pool: Character[]
  guesses: GuessEntry[]
  guessedIds: Set<string>
  hangman: HangmanState
  finished: boolean
  disabled?: boolean
  onGuess: (c: Character) => void
  emptyHint: string
}) {
  const inputRef = useRef<HTMLDivElement>(null)
  const count = guesses.length

  // Keep the input in view as the grid grows beneath it.
  useEffect(() => {
    if (count > 0 && !finished) {
      inputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [count, finished])

  return (
    <>
      {guesses.length === 0 && (
        <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
          {emptyHint}
        </Typography>
      )}

      <GuessGrid guesses={guesses} />

      {!finished && (
        <Box ref={inputRef} sx={{ pt: 0, pb: `${DROPDOWN_ROOM}px` }}>
          <Box sx={{ mb: 1.5 }}>
            <HangmanBar state={hangman} />
          </Box>
          <GuessInput pool={pool} guessed={guessedIds} disabled={disabled} onGuess={onGuess} />
        </Box>
      )}
    </>
  )
}
