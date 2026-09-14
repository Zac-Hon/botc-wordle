import { useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { Link as RouterLink } from 'react-router-dom'
import { CATEGORY_LABELS, useAchievements, type Achievement } from '../game/useAchievements'
import { getFrame } from '../game/frames'
import { isConfigured } from '../lib/supabase'
import { useAuth } from '../store/auth'

const CATEGORY_ORDER: Achievement['category'][] = ['dailies', 'collection', 'versus']

function Row({ item }: { item: Achievement }) {
  const done = item.earned_at !== null
  const frame = getFrame(item.grants_frame)
  const pct = item.goal > 0 ? Math.min(100, (item.progress / item.goal) * 100) : 0

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'flex-start', py: 1.25, opacity: done ? 1 : 0.72 }}
    >
      {done ? (
        <CheckCircleIcon sx={{ color: 'primary.main', flexShrink: 0, mt: 0.25 }} />
      ) : (
        <RadioButtonUncheckedIcon sx={{ color: 'text.secondary', flexShrink: 0, mt: 0.25 }} />
      )}

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {item.name}
          </Typography>
          {item.grants_title && (
            <Chip size="small" variant="outlined" label={`Title: ${item.grants_title}`} />
          )}
          {frame && (
            <Chip
              size="small"
              variant="outlined"
              label={`Frame: ${frame.name}`}
              sx={{ borderColor: frame.color, color: frame.color }}
            />
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {item.description}
        </Typography>

        {/* A one-step milestone has nothing useful to show as a bar. */}
        {!done && item.goal > 1 && (
          <Box sx={{ mt: 0.75, maxWidth: 320 }}>
            <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
            <Typography variant="caption" color="text.secondary">
              {item.progress} / {item.goal}
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  )
}

export function Achievements() {
  const { user, loading: authLoading } = useAuth()
  const { items, loading, error } = useAchievements()

  const grouped = useMemo(() => {
    const map = new Map<Achievement['category'], Achievement[]>()
    for (const a of items ?? []) {
      if (!map.has(a.category)) map.set(a.category, [])
      map.get(a.category)!.push(a)
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const)
  }, [items])

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Achievements need the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (authLoading || loading) {
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
          Achievements
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to start earning titles and frames.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  const all = items ?? []
  const done = all.filter((a) => a.earned_at !== null).length

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Box>
        <Typography variant="h5">Achievements</Typography>
        <Typography variant="body2" color="text.secondary">
          Each one you finish unlocks a title, and a few unlock a frame for your avatar. Wear them
          on your <RouterLink to="/profile">profile</RouterLink>.
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontFamily: 'inherit', fontWeight: 700 }}>
          {done} / {all.length}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={all.length > 0 ? (done / all.length) * 100 : 0}
          sx={{ height: 8, borderRadius: 4, mt: 1 }}
        />
      </Paper>

      {grouped.map(([category, list]) => (
        <Paper key={category} elevation={0} sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            {CATEGORY_LABELS[category]}
          </Typography>
          <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
            {list.map((a) => (
              <Row key={a.id} item={a} />
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  )
}
