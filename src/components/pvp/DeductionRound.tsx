import { useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { BY_ID } from '../../data/pools'
import { GuessGrid, type GuessEntry } from '../GuessGrid'
import { GuessInput } from '../GuessInput'
import { HangmanBar } from '../HangmanBar'
import { RoundTimer } from './RoundTimer'
import { revealHangman } from '../../game/hangman'
import { PVP_GUESS_CAP } from '../../game/scoring'
import type { PvpRound } from '../../game/usePvp'
import type { Character } from '../../game/types'

/** Rounds two and three: the solo grid, capped at eight guesses. */
export function DeductionRound({
  round,
  pool,
  skewMs,
  onGuess,
}: {
  round: PvpRound
  pool: Character[]
  skewMs: number
  onGuess: (characterId: string) => void
}) {
  const guesses: GuessEntry[] = useMemo(
    () =>
      round.myGuesses
        .filter((g) => g.id && g.clue)
        .map((g) => ({
          id: g.id!,
          name: g.name ?? g.id!,
          image: BY_ID.get(g.id!)?.image ?? `${g.id}.webp`,
          clue: g.clue!,
        })),
    [round.myGuesses],
  )

  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.id)), [guesses])
  const remaining = PVP_GUESS_CAP - round.myGuessCount
  const done = round.mySolved || round.myFinished || remaining <= 0

  const hangman = revealHangman(
    round.answerName ?? '',
    round.myGuessCount - (round.mySolved ? 1 : 0),
    round.id,
  )

  const answer = round.answerId ? BY_ID.get(round.answerId) : null

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }} useFlexGap>
          <Typography variant="overline" color="text.secondary">
            Round {round.roundNo} ·{' '}
            {round.kind === 'race' ? 'Same character, fewest guesses wins' : 'Chosen for you'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip
            size="small"
            color={remaining <= 2 ? 'secondary' : 'default'}
            label={`${Math.max(0, remaining)} of ${PVP_GUESS_CAP} left`}
          />
        </Stack>

        {round.endsAt && !done && (
          <RoundTimer
            endsAt={round.endsAt}
            startedAt={round.startedAt}
            skewMs={skewMs}
            label="Round ends in"
          />
        )}

        {done && (
          <Alert severity={round.mySolved ? 'success' : 'info'}>
            {round.mySolved
              ? `Solved in ${round.myGuessCount}, ${Math.round(round.myPoints)} points.`
              : 'Out of guesses.'}
            {answer && ` It was the ${answer.name}.`}
            {!round.mySolved && ' Waiting for your opponent…'}
          </Alert>
        )}
      </Paper>

      <GuessGrid guesses={guesses} />

      {!done && (
        <Box sx={{ pb: '300px' }}>
          <Box sx={{ mb: 1.5 }}>
            <HangmanBar state={hangman} />
          </Box>
          <GuessInput pool={pool} guessed={guessedIds} onGuess={(c) => onGuess(c.id)} />
        </Box>
      )}
    </Stack>
  )
}
