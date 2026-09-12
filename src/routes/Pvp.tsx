import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'

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

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Start a match
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

      <Divider>or</Divider>

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Join a match
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
