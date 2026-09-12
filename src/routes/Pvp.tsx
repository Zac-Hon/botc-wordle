import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { useQueue } from '../game/useQueue'
import { FULL_POOL } from '../data/pools'

/** Create or join a match. The match itself lives at /pvp/:matchId. */
export function Pvp() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Versus needs the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (loading) return null

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Versus
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Head-to-head needs an account so your opponent knows who they are playing.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  const run = async (fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    setBusy(true)
    setError(null)
    const { data, error: err } = await fn()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    const result = data as { matchId: string }
    navigate(`/pvp/${result.matchId}`)
  }

  return (
    <Stack spacing={2} sx={{ py: 1, maxWidth: 520, mx: 'auto' }}>
      <Box>
        <Typography variant="h5">Versus</Typography>
        <Typography variant="body2" color="text.secondary">
          Two players, three rounds a cycle: recognise a token, race to deduce a character, then
          set one for each other.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Ranked />

      <Divider>or play a friend</Divider>

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Start a private match
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You get a code to send your opponent.
        </Typography>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void run(() => supabase.rpc('pvp_create', { p_cycles: 1 }))}
        >
          Create match
        </Button>
      </Paper>

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Join with a code
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            slotProps={{ htmlInput: { maxLength: 6, style: { textTransform: 'uppercase', letterSpacing: 4 } } }}
            size="small"
            fullWidth
          />
          <Button
            variant="outlined"
            disabled={busy || code.trim().length < 4}
            onClick={() => void run(() => supabase.rpc('pvp_join', { p_code: code.trim() }))}
          >
            Join
          </Button>
        </Stack>
      </Paper>
    </Stack>
  )
}

/**
 * Ranked queue.
 *
 * Ranked settings are fixed rather than chosen: the Daily Full pool, one cycle.
 * A rating only means something if every ranked game is the same game, so there
 * is deliberately nothing to configure here.
 */
function Ranked() {
  const queue = useQueue()
  const navigate = useNavigate()

  useEffect(() => {
    if (queue.status === 'matched' && queue.matchId) {
      navigate(`/pvp/${queue.matchId}`)
    }
  }, [queue.status, queue.matchId, navigate])

  const waiting = queue.status === 'queued'

  return (
    <Paper elevation={0} sx={{ p: 2.5, borderColor: 'primary.main', borderWidth: 1, borderStyle: 'solid' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="subtitle1">Ranked</Typography>
        <Box sx={{ flex: 1 }} />
        {queue.rating !== null && <Chip size="small" label={`Your rating ${queue.rating}`} />}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Queue against anyone else looking for a game. Every ranked match uses the same settings as
        Daily Full, {FULL_POOL.length} characters, one cycle of three rounds. Your rating moves
        with each result.
      </Typography>

      {queue.error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={queue.clearError}>
          {queue.error}
        </Alert>
      )}

      {waiting ? (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CircularProgress size={22} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Looking for an opponent...
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {queue.waitedSeconds}s
                {queue.tolerance !== null && `, searching within ${queue.tolerance} rating`}
              </Typography>
            </Box>
          </Stack>
          <Box>
            <Button size="small" color="secondary" onClick={() => void queue.leave()}>
              Cancel
            </Button>
          </Box>
        </Stack>
      ) : (
        <Button variant="contained" disabled={queue.busy} onClick={() => void queue.join()}>
          {queue.busy ? 'Joining...' : 'Find a match'}
        </Button>
      )}
    </Paper>
  )
}
