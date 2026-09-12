import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { isConfigured } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { validateUsername } from '../lib/supabase'

export function SignIn({ mode }: { mode: 'in' | 'up' }) {
  const { signIn, signUp, error, clearError, user } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  // Signing in leaves you on the form otherwise, which reads as a failure even
  // though it worked. Redirect once the session actually lands.
  useEffect(() => {
    if (user) navigate('/home', { replace: true })
  }, [user, navigate])

  const registering = mode === 'up'
  const usernameError = touched ? validateUsername(username) : null
  const passwordError =
    touched && registering && password.length > 0 && password.length < 6
      ? 'At least 6 characters'
      : null
  const canSubmit =
    username.trim().length > 0 && password.length > 0 && !validateUsername(username) && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setBusy(true)
    try {
      await (registering ? signUp(username, password) : signIn(username, password))
    } finally {
      setBusy(false)
    }
  }

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Accounts need the Supabase keys in <code>.env</code>. See SETUP.md. Endless mode works
        without them.
      </Alert>
    )
  }

  return (
    <Paper elevation={0} sx={{ p: 3, maxWidth: 420, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" gutterBottom>
        {registering ? 'Create an account' : 'Sign in'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {registering
          ? 'A username and password is all you need. No email required.'
          : 'Welcome back.'}
      </Typography>

      <Box component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" onClose={clearError}>
              {error}
            </Alert>
          )}

          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => setTouched(true)}
            error={Boolean(usernameError)}
            helperText={usernameError ?? ' '}
            autoComplete="username"
            autoFocus
            fullWidth
          />

          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            error={Boolean(passwordError)}
            helperText={passwordError ?? ' '}
            autoComplete={registering ? 'new-password' : 'current-password'}
            fullWidth
          />

          <Button type="submit" variant="contained" size="large" disabled={!canSubmit}>
            {busy ? 'Working…' : registering ? 'Create account' : 'Sign in'}
          </Button>

          <Typography variant="body2" color="text.secondary" align="center">
            {registering ? (
              <>
                Already have one?{' '}
                <Link component={RouterLink} to="/signin">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link component={RouterLink} to="/signup">
                  Create an account
                </Link>
              </>
            )}
          </Typography>

          {registering && (
            <Typography variant="caption" color="text.secondary">
              There is no password reset, because accounts have no email address. Pick something
              you will remember.
            </Typography>
          )}
        </Stack>
      </Box>
    </Paper>
  )
}
