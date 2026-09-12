import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { DEFAULT_ENDLESS_POOL, endlessPool, type EndlessPoolOptions } from '../data/pools'
import { PlayArea } from '../components/PlayArea'
import { ResultCard } from '../components/ResultCard'
import { ShareButton } from '../components/ShareButton'
import { rememberRecent } from '../game/endlessPicker'
import { useEndlessGame } from '../game/useEndlessGame'
import { useAuth } from '../store/auth'

const TOGGLES: { key: keyof EndlessPoolOptions; label: string; hint: string }[] = [
  { key: 'base3', label: 'Base 3', hint: 'Trouble Brewing, Bad Moon Rising, Sects & Violets' },
  { key: 'experimental', label: 'Experimental', hint: 'Characters without a home script yet' },
  { key: 'travellers', label: 'Travellers', hint: 'Late joiners with powerful abilities' },
  {
    key: 'storyteller',
    label: 'Fabled & Loric',
    hint: 'Storyteller characters. Two clue columns barely work for these, so the grid is weaker.',
  },
]

export function Endless() {
  const { user } = useAuth()
  const [opts, setOpts] = useState<EndlessPoolOptions>(DEFAULT_ENDLESS_POOL)
  const pool = useMemo(() => endlessPool(opts), [opts])
  const game = useEndlessGame(pool, opts, Boolean(user))
  const useAuthHasUser = Boolean(user)

  // Remember what was served so the next deal can avoid it. The server takes
  // this list as an exclusion, which is why it is kept even though the answer
  // itself is chosen server side.
  useEffect(() => {
    if (game.revealed) rememberRecent(game.revealed.id)
  }, [game.revealed])

  const toggle = (key: keyof EndlessPoolOptions) => {
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // An empty pool has no answer to find, so refuse the last toggle off.
      return endlessPool(next).length === 0 ? prev : next
    })
  }

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Endless
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Play as many as you like. Nothing here counts towards your streak.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {TOGGLES.map((t) => (
            <FormControlLabel
              key={t.key}
              title={t.hint}
              control={<Switch size="small" checked={opts[t.key]} onChange={() => toggle(t.key)} />}
              label={<Typography variant="body2">{t.label}</Typography>}
              sx={{ mr: 1.5 }}
            />
          ))}
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Chip size="small" label={`${pool.length} characters`} />
          <Chip
            size="small"
            variant="outlined"
            label={`${game.guesses.length} ${game.guesses.length === 1 ? 'guess' : 'guesses'}`}
          />
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => void game.deal()} disabled={game.busy}>
            New character
          </Button>
          {!game.finished && game.guesses.length > 0 && (
            <Button size="small" color="secondary" onClick={() => void game.giveUp()}>
              Give up
            </Button>
          )}
        </Stack>

        {!useAuthHasUser && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            You are playing signed out, so these wins are not added to your collection. Sign in to
            keep them.
          </Alert>
        )}

        {opts.storyteller && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            Fabled and Loric are in the pool. Their Script column just repeats their Type, and
            their abilities all share one tag, so two of the seven clues stop being useful. They
            never appear in the dailies, so Endless is the only way to collect them, and a win
            here earns them the gold ring.
          </Alert>
        )}
      </Paper>

      {game.error && (
        <Alert severity="error" onClose={game.clearError}>
          {game.error}
        </Alert>
      )}

      {game.finished && game.revealed && (
        <ResultCard
          answer={game.revealed}
          solved={game.solved}
          guessCount={game.guesses.length}
          onPlayAgain={() => void game.deal()}
          extra={
            <ShareButton mode="Endless" guesses={game.guesses} solved={game.solved} />
          }
        />
      )}

      <PlayArea
        pool={pool}
        guesses={game.guesses}
        guessedIds={game.guessedIds}
        hangman={game.hangman}
        finished={game.finished}
        disabled={game.busy}
        onGuess={(c) => void game.guess(c)}
        emptyHint="Name any character to begin. Each guess is compared across seven attributes."
      />
    </Stack>
  )
}
