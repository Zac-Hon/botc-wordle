import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { VALUE_LABELS } from '../game/clueSpec'
import type { Character } from '../game/types'
import { tokenSrcFromFile } from '../lib/tokens'

/** Shown once the game is over: the token, the ability, and what it took. */
export function ResultCard({
  answer,
  solved,
  guessCount,
  onPlayAgain,
  extra,
}: {
  answer: Character
  solved: boolean
  guessCount: number
  onPlayAgain?: () => void
  extra?: React.ReactNode
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderColor: solved ? 'success.main' : 'secondary.main',
        borderWidth: 1,
        borderStyle: 'solid',
      }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box
          component="img"
          src={tokenSrcFromFile(answer.image)}
          alt={answer.name}
          sx={{ width: 76, height: 76, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="overline" color={solved ? 'success.main' : 'secondary.main'}>
            {solved ? `Solved in ${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'}` : 'Gave up'}
          </Typography>
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            {answer.name}
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={VALUE_LABELS[answer.attrs.team] ?? answer.attrs.team} />
            <Chip
              size="small"
              variant="outlined"
              label={VALUE_LABELS[answer.attrs.script] ?? answer.attrs.script}
            />
            {answer.affectsSetup && <Chip size="small" variant="outlined" label="Affects setup" />}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {answer.ability}
          </Typography>

          {answer.flavor && (
            <Typography
              variant="body2"
              sx={{ mt: 1, fontStyle: 'italic', color: 'text.secondary', opacity: 0.75 }}
            >
              “{answer.flavor}”
            </Typography>
          )}
        </Box>
      </Stack>

      {(extra || onPlayAgain) && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap>
          {extra}
          {onPlayAgain && (
            <Button variant="contained" onClick={onPlayAgain}>
              Play again
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  )
}
