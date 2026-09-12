import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { BY_ID } from '../data/pools'
import { checkPronouns } from '../lib/moderation'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { useCollection } from '../game/useCollection'

export function Profile() {
  const { user, username, loading: authLoading, loadProfile } = useAuth()
  const { ownedCharacters, loading: collLoading } = useCollection()

  const [pronouns, setPronouns] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user || !isConfigured) return
    void supabase
      .from('profiles')
      .select('pronouns, avatar_character_id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPronouns(data?.pronouns ?? '')
        setAvatar(data?.avatar_character_id ?? null)
        setLoaded(true)
      })
  }, [user])

  const pronounError = useMemo(() => {
    const result = checkPronouns(pronouns)
    return result.ok ? null : (result.reason ?? 'Not allowed')
  }, [pronouns])

  const sorted = useMemo(
    () => [...ownedCharacters].sort((a, b) => a.name.localeCompare(b.name)),
    [ownedCharacters],
  )

  const save = async () => {
    if (pronounError) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('update_profile', {
      p_pronouns: pronouns.trim(),
      p_avatar: avatar,
      p_clear_pronouns: pronouns.trim().length === 0,
      p_clear_avatar: avatar === null,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    await loadProfile()
    setToast('Profile saved')
  }

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Profiles need the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Profile
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin" sx={{ mt: 1 }}>
          Sign in
        </Button>
      </Paper>
    )
  }

  const avatarChar = avatar ? BY_ID.get(avatar) : null

  return (
    <Stack spacing={2} sx={{ py: 1, maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5">Profile</Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
          <Avatar
            src={avatarChar ? `${import.meta.env.BASE_URL}tokens/${avatarChar.image}` : undefined}
            sx={{ width: 64, height: 64, bgcolor: 'background.default' }}
          >
            {username?.[0]?.toUpperCase()}
          </Avatar>
          <Box>
            <Typography variant="h6">{username}</Typography>
            <Typography variant="body2" color="text.secondary">
              {avatarChar ? avatarChar.name : 'No character picked'}
            </Typography>
          </Box>
        </Stack>

        <TextField
          label="Pronouns"
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value)}
          placeholder="she/her, he/him, they/them"
          error={Boolean(pronounError)}
          helperText={pronounError ?? 'Optional. Shown next to your name on the leaderboard.'}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        />

        <Button variant="contained" onClick={() => void save()} disabled={saving || Boolean(pronounError)}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Paper>

      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Profile picture
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pick any character you have named. Solve more to unlock more, in any mode.
        </Typography>

        {collLoading ? (
          <CircularProgress size={24} />
        ) : sorted.length === 0 ? (
          <Alert severity="info">
            You have not named anyone yet. Play a game and your first character appears here.
          </Alert>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {sorted.map((c) => (
              <Tooltip key={c.id} title={c.name} enterTouchDelay={0} disableInteractive>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => setAvatar(avatar === c.id ? null : c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setAvatar(avatar === c.id ? null : c.id)
                  }}
                  sx={{
                    cursor: 'pointer',
                    borderRadius: 1.5,
                    p: 0.5,
                    border: '2px solid',
                    borderColor: avatar === c.id ? 'primary.main' : 'transparent',
                    '&:hover': { borderColor: 'divider' },
                  }}
                >
                  <Box
                    component="img"
                    src={`${import.meta.env.BASE_URL}tokens/${c.image}`}
                    alt={c.name}
                    loading="lazy"
                    width={48}
                    height={48}
                    sx={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </Box>
              </Tooltip>
            ))}
          </Box>
        )}
      </Paper>

      {!loaded && <CircularProgress size={20} />}

      <Snackbar
        open={toast !== null}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  )
}
