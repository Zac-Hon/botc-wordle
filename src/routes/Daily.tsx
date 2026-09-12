import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { CLASSIC_POOL, FULL_POOL } from '../data/pools'
import { PlayArea } from '../components/PlayArea'
import { ResultCard } from '../components/ResultCard'
import { ShareButton } from '../components/ShareButton'
import { isConfigured } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { useDailyGame } from '../game/useDailyGame'
import { todayUTC, type DailyMode } from '../game/daily'

const COPY: Record<DailyMode, { title: string; blurb: string }> = {
  classic: {
    title: 'Daily Classic',
    blurb: 'Trouble Brewing, Bad Moon Rising and Sects & Violets, travellers included.',
  },
  full: {
    title: 'Daily Full',
    blurb: 'Every player character, including experimentals. Considerably harder.',
  },
}

export function Daily({ mode, date }: { mode: DailyMode; date?: string }) {
  const { user, loading: authLoading } = useAuth()
  const pool = mode === 'classic' ? CLASSIC_POOL : FULL_POOL
  const game = useDailyGame(mode, date)
  const copy = COPY[mode]
  // An archive replay is explicitly a puzzle you missed, so it must not touch
  // streaks. The server marks the session is_archive and the stats exclude it.
  const isArchive = Boolean(date) && date !== todayUTC()

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        The dailies need the Supabase keys in <code>.env</code>, see SETUP.md. Meanwhile,{' '}
        <Link component={RouterLink} to="/endless" color="inherit" underline="always">
          Endless
        </Link>{' '}
        works with no backend at all.
      </Alert>
    )
  }

  if (authLoading) {
    return <Loading />
  }

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          {copy.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The dailies track streaks and a leaderboard, so they need an account.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
          <Button variant="contained" component={RouterLink} to="/signup">
            Create an account
          </Button>
          <Button component={RouterLink} to="/signin">
            Sign in
          </Button>
        </Stack>
      </Paper>
    )
  }

  if (game.loading) return <Loading />

  if (game.error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {game.error}
        <Box sx={{ mt: 1, fontSize: 13, opacity: 0.8 }}>
          If this says no puzzle is seeded, run <code>supabase/seed/dailies.sql</code> in the SQL
          editor.
        </Box>
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="h6">{copy.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {copy.blurb}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Chip size="small" label={date ?? todayUTC()} />
          {isArchive && <Chip size="small" color="warning" variant="outlined" label="Archive" />}
          <Chip size="small" variant="outlined" label={`${pool.length} characters`} />
          <Chip
            size="small"
            variant="outlined"
            label={`${game.guesses.length} ${game.guesses.length === 1 ? 'guess' : 'guesses'}`}
          />
          <Box sx={{ flex: 1 }} />
          {!game.finished && game.guesses.length > 0 && (
            <Button size="small" color="secondary" onClick={game.giveUp}>
              Give up
            </Button>
          )}
        </Stack>
      </Paper>

      {game.finished && game.answer && (
        <ResultCard
          answer={game.answer}
          solved={game.solved}
          guessCount={game.guesses.length}
          extra={
            <ShareButton
              mode={copy.title}
              date={date ?? todayUTC()}
              guesses={game.guesses}
              solved={game.solved}
              isArchive={isArchive}
            />
          }
        />
      )}

      <PlayArea
        pool={pool}
        guesses={game.guesses}
        guessedIds={game.guessedIds}
        hangman={game.hangman}
        finished={game.finished}
        disabled={game.submitting}
        onGuess={game.guess}
        emptyHint={
          isArchive
            ? 'A puzzle you missed. Replays do not count towards your streak.'
            : 'One puzzle a day, the same for everyone. Resets at midnight UTC.'
        }
      />
    </Stack>
  )
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  )
}
