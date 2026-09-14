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
import Chip from '@mui/material/Chip'
import { Link as RouterLink } from 'react-router-dom'
import { BY_ID } from '../data/pools'
import { getFrame } from '../game/frames'
import { frameSx } from '../game/frames'
import { useAchievements } from '../game/useAchievements'
import { checkPronouns } from '../lib/moderation'
import { isConfigured, supabase } from '../lib/supabase'
import { tokenSrc } from '../lib/tokens'
import { useAuth } from '../store/auth'
import { useCollection } from '../game/useCollection'

export function Profile() {
  const {
    user,
    username,
    loading: authLoading,
    loadProfile,
    pronouns: storePronouns,
    avatar: storeAvatar,
    title: storeTitle,
    frame: storeFrame,
  } = useAuth()
  const { ownedCharacters, loading: collLoading } = useCollection()
  const { titles, frames, loading: achLoading } = useAchievements()

  const [pronouns, setPronouns] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // The store already holds the whole profile, so this seeds the form from it
  // rather than making a second request for what the top bar just fetched.
  //
  // It waits for a username before seeding, because that is the signal that
  // loadProfile has resolved; seeding on `user` alone would fill the form with
  // the store's initial nulls and then never correct itself. It seeds exactly
  // once, so a later refresh cannot discard an edit in progress.
  useEffect(() => {
    if (!user || loaded || username === null) return
    setPronouns(storePronouns ?? '')
    setAvatar(storeAvatar)
    setTitle(storeTitle)
    setFrame(storeFrame)
    setLoaded(true)
  }, [user, loaded, username, storePronouns, storeAvatar, storeTitle, storeFrame])

  // A different account gets a fresh form.
  useEffect(() => setLoaded(false), [user?.id])

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
    const base = {
      p_pronouns: pronouns.trim(),
      p_avatar: avatar,
      p_clear_pronouns: pronouns.trim().length === 0,
      p_clear_avatar: avatar === null,
    }

    let { error: err } = await supabase.rpc('update_profile', {
      ...base,
      p_title: title,
      p_frame: frame,
      p_clear_title: title === null,
      p_clear_frame: frame === null,
    })

    // Titles and frames arrive with migration 17. A deploy that lands before
    // the SQL is applied would otherwise make saving a profile fail outright,
    // taking pronouns and the avatar down with a feature nobody has yet.
    if (err && /update_profile/i.test(err.message)) {
      ;({ error: err } = await supabase.rpc('update_profile', base))
    }

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
          <Box sx={{ ...frameSx(frame), borderRadius: '50%', p: '3px', display: 'inline-flex' }}>
            <Avatar
              src={tokenSrc(avatarChar)}
              sx={{ width: 64, height: 64, bgcolor: 'background.default' }}
            >
              {username?.[0]?.toUpperCase()}
            </Avatar>
          </Box>
          <Box>
            <Typography variant="h6">{username}</Typography>
            {title && (
              <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }}>
                {title}
              </Typography>
            )}
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

        <Typography variant="subtitle2" gutterBottom>
          Title
        </Typography>
        {achLoading ? (
          <CircularProgress size={20} sx={{ mb: 2, display: 'block' }} />
        ) : titles.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No titles yet. <RouterLink to="/achievements">Achievements</RouterLink> shows how to earn
            them.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }} useFlexGap>
            <Chip
              size="small"
              label="None"
              color={title === null ? 'primary' : 'default'}
              variant={title === null ? 'filled' : 'outlined'}
              onClick={() => setTitle(null)}
            />
            {titles.map((t) => (
              <Chip
                key={t}
                size="small"
                label={t}
                color={title === t ? 'primary' : 'default'}
                variant={title === t ? 'filled' : 'outlined'}
                onClick={() => setTitle(t)}
              />
            ))}
          </Stack>
        )}

        <Typography variant="subtitle2" gutterBottom>
          Frame
        </Typography>
        {achLoading ? (
          <CircularProgress size={20} sx={{ mb: 2, display: 'block' }} />
        ) : frames.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No frames yet. A few achievements unlock one.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }} useFlexGap>
            <Chip
              size="small"
              label="None"
              color={frame === null ? 'primary' : 'default'}
              variant={frame === null ? 'filled' : 'outlined'}
              onClick={() => setFrame(null)}
            />
            {frames.map((id) => {
              const f = getFrame(id)
              return (
                <Chip
                  key={id}
                  size="small"
                  label={f?.name ?? id}
                  variant={frame === id ? 'filled' : 'outlined'}
                  onClick={() => setFrame(id)}
                  sx={
                    f
                      ? {
                          borderColor: f.color,
                          color: frame === id ? undefined : f.color,
                          bgcolor: frame === id ? f.color : undefined,
                        }
                      : undefined
                  }
                />
              )
            })}
          </Stack>
        )}

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
                    src={tokenSrc(c)}
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
