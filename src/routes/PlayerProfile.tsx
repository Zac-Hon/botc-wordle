import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { VALUE_LABELS } from '../game/clueSpec'
import { frameSx } from '../game/frames'
import { isConfigured, supabase } from '../lib/supabase'
import { tokenSrc } from '../lib/tokens'
import { useAuth } from '../store/auth'
import { BY_ID } from '../data/pools'

interface PublicProfile {
  username: string
  pronouns: string | null
  avatar: string | null
  title: string | null
  frame: string | null
  joinedAt: string
  played: number
  wins: number
  bestStreak: number
  collected: number
  collectedDaily: number
  mastered: number
  rating: number | null
  peakRating: number | null
  pvpGames: number
  pvpWins: number
  pvpLosses: number
  bySet: { script: string; have: number; total: number }[]
  achievements: { id: string; name: string; description: string; earnedAt: string }[]
  totalAchievements: number
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: { xs: 1, sm: 1.5 }, textAlign: 'center' }}>
      <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: { xs: 17, sm: 22 } }}>
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontSize: { xs: 10, sm: 12 }, display: 'block' }}
      >
        {label}
      </Typography>
    </Paper>
  )
}

export function PlayerProfile() {
  const { username = '' } = useParams()
  const { user, username: myName, loading: authLoading } = useAuth()
  const [data, setData] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !isConfigured || !username) return
    setData(null)
    setError(null)
    void supabase.rpc('public_profile', { p_username: username }).then(({ data: d, error: err }) => {
      if (err) setError(err.message)
      else setData(d as PublicProfile)
    })
  }, [user, username])

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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to look at other players.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    )
  }

  if (!data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const avatarChar = data.avatar ? BY_ID.get(data.avatar) : null
  const isMe = myName !== null && myName.toLowerCase() === data.username.toLowerCase()
  const winRate = data.played > 0 ? Math.round((data.wins / data.played) * 100) : null

  return (
    <Stack spacing={2} sx={{ py: 1, maxWidth: 720, mx: 'auto' }}>
      <Paper elevation={0} sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ ...frameSx(data.frame), borderRadius: '50%', p: '3px', display: 'inline-flex' }}>
            <Avatar
              src={tokenSrc(avatarChar)}
              sx={{ width: 64, height: 64, bgcolor: 'background.default' }}
            >
              {data.username[0]?.toUpperCase()}
            </Avatar>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">{data.username}</Typography>
            {data.title && (
              <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }}>
                {data.title}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {[data.pronouns, avatarChar?.name].filter(Boolean).join(' · ') || 'N/A'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {isMe && (
            <Button size="small" component={RouterLink} to="/profile">
              Edit
            </Button>
          )}
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Played" value={data.played} />
        <Stat label="Win rate" value={winRate !== null ? `${winRate}%` : 'N/A'} />
        <Stat label="Best streak" value={data.bestStreak} />
        <Stat label="Rating" value={data.rating ?? 'N/A'} />
      </Box>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          Collection
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
          <Chip size="small" variant="outlined" label={`${data.collected} named`} />
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={`${data.collectedDaily} gold rings`}
          />
          <Chip size="small" variant="outlined" label={`${data.mastered} mastered`} />
        </Stack>
        <Stack spacing={1}>
          {data.bySet.map((s) => (
            <Box key={s.script}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption">{VALUE_LABELS[s.script] ?? s.script}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {s.have} / {s.total}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={s.total > 0 ? (s.have / s.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          ))}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          Achievements {data.achievements.length} / {data.totalAchievements}
        </Typography>
        {data.achievements.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing earned yet.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {data.achievements.map((a) => (
              <Chip key={a.id} size="small" label={a.name} title={a.description} />
            ))}
          </Stack>
        )}
      </Paper>

      {data.pvpGames > 0 && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Versus
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {data.pvpWins} won, {data.pvpLosses} lost across {data.pvpGames} ranked matches. Peak
            rating {data.peakRating}.
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}
