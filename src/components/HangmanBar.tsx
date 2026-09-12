import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { HANGMAN_START, type HangmanState } from '../game/hangman'

/**
 * The name reveal that opens after HANGMAN_START wrong guesses, uncovering one
 * more letter each time. Before that it shows how close the help is, so the
 * player knows it exists and is not left wondering.
 */
export function HangmanBar({ state }: { state: HangmanState }) {
  if (!state.active) {
    const remaining = state.nextRevealIn ?? HANGMAN_START
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
        {remaining === 1
          ? 'One more wrong guess reveals the name’s length'
          : `${remaining} more wrong guesses reveal the name’s length`}
      </Typography>
    )
  }

  return (
    <Paper
      elevation={0}
      sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}
    >
      <Box
        // The blanks are the point; announce the whole thing as one live region
        // rather than letter by letter.
        aria-live="polite"
        aria-label={`Name so far: ${state.slots.map((s) => (s.revealed ? s.char : 'blank')).join(' ')}`}
        sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}
      >
        {state.slots.map((slot, i) => (
          <Box
            key={i}
            aria-hidden
            sx={{
              width: slot.structural ? 10 : 22,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 20,
              lineHeight: 1.2,
              textAlign: 'center',
              color: slot.revealed && !slot.structural ? 'primary.main' : 'text.primary',
              borderBottom: slot.structural ? 'none' : '2px solid',
              borderColor: 'divider',
            }}
          >
            {slot.revealed ? slot.char : ' '}
          </Box>
        ))}
      </Box>

      <Typography variant="caption" color="text.secondary">
        {state.revealedCount} of {state.letterCount} letters
        {state.nextRevealIn !== null && ' · next letter on your next wrong guess'}
      </Typography>
    </Paper>
  )
}
