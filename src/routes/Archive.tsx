import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { todayUTC, type DailyMode } from '../game/daily'

interface ArchiveRow {
  puzzle_date: string
  mode: string
  played: boolean
  solved: boolean
  gave_up: boolean
  guess_count: number
  is_archive: boolean
}

const PAGE = 30

export function Archive() {
  const { user, loading: authLoading } = useAuth()
  const [mode, setMode] = useState<DailyMode>('classic')
  const [rows, setRows] = useState<ArchiveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = useCallback(
    async (before?: string) => {
      setLoading(true)
      const { data, error: err } = await supabase.rpc('archive_list', {
        p_mode: mode,
        p_limit: PAGE,
        p_before: before ?? null,
      })
      if (err) setError(err.message)
      const page = (data as ArchiveRow[]) ?? []
      setRows((prev) => (before ? [...prev, ...page] : page))
      setDone(page.length < PAGE)
      setLoading(false)
    },
    [mode],
  )

  useEffect(() => {
    if (!user) return
    setRows([])
    setDone(false)
    void load()
  }, [user, mode, load])

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        The archive needs the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (authLoading) return <Centered><CircularProgress /></Centered>

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Archive
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to replay the puzzles you missed.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  const today = todayUTC()

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Box>
        <Typography variant="h5">Archive</Typography>
        <Typography variant="body2" color="text.secondary">
          Every past puzzle. Replays are marked and never affect your streak.
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Tabs value={mode} onChange={(_, v: DailyMode) => setMode(v)}>
        <Tab value="classic" label="Classic" />
        <Tab value="full" label="Full" />
      </Tabs>

      <Stack spacing={1}>
        {rows.map((r) => {
          const isToday = r.puzzle_date === today
          const to = isToday ? `/daily/${r.mode}` : `/archive/${r.mode}/${r.puzzle_date}`
          return (
            <Paper
              key={`${r.mode}-${r.puzzle_date}`}
              elevation={0}
              onClick={() => navigate(to)}
              sx={{
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                transition: 'border-color 140ms ease',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', width: 28 }}>
                {r.played && r.solved && <CheckCircleIcon color="success" fontSize="small" />}
                {r.played && !r.solved && <CancelIcon color="secondary" fontSize="small" />}
                {!r.played && <PlayArrowIcon sx={{ color: 'text.secondary' }} fontSize="small" />}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.puzzle_date}
                  {isToday && ' · today'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {!r.played
                    ? 'Not played'
                    : r.solved
                      ? `Solved in ${r.guess_count}`
                      : r.gave_up
                        ? 'Gave up'
                        : `In progress · ${r.guess_count} guesses`}
                </Typography>
              </Box>

              {r.is_archive && <Chip size="small" variant="outlined" label="Replay" />}
            </Paper>
          )
        })}
      </Stack>

      {loading && <Centered><CircularProgress size={28} /></Centered>}

      {!loading && !done && rows.length > 0 && (
        <Button onClick={() => void load(rows[rows.length - 1].puzzle_date)}>Load older</Button>
      )}

      {!loading && rows.length === 0 && (
        <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
          No puzzles yet.
        </Typography>
      )}
    </Stack>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>{children}</Box>
}
