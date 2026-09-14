import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import { Link as RouterLink } from 'react-router-dom'
import { BY_ID } from '../data/pools'
import { VersusStats, type PvpStats, type RatingRow } from '../components/VersusStats'
import { VALUE_LABELS } from '../game/clueSpec'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { todayUTC, type DailyMode } from '../game/daily'
import { DISTRIBUTION_BUCKETS, computeStats, type SessionRow } from '../game/stats'

interface GlobalRow {
  username: string
  pronouns: string | null
  avatar: string | null
  played: number
  wins: number
  avg_guesses: number | null
  collected: number
  best_streak: number
}

interface DetailStats {
  username: string
  mode: string | null
  collected: number
  collectedDaily: number
  totalCharacters: number
  fastest: { characterId: string; name: string; seconds: number; guesses: number } | null
  toughest: { characterId: string; name: string; guesses: number } | null
  byScript: { script: string; wins: number; avgGuesses: number }[]
}

interface LeaderRow {
  username: string
  pronouns: string | null
  avatar: string | null
  mode: string
  guess_count: number
  solved: boolean
}

export function Stats() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<'me' | 'everyone' | 'versus'>('me')
  const [mode, setMode] = useState<DailyMode>('classic')

  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [detail, setDetail] = useState<DetailStats | null>(null)
  const [global, setGlobal] = useState<GlobalRow[] | null>(null)
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null)
  const [pvp, setPvp] = useState<PvpStats | null>(null)
  const [ladder, setLadder] = useState<RatingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sessions, the global table and today's board do not depend on the mode
  // tab, so they load once.
  useEffect(() => {
    if (!user || !isConfigured) return
    void (async () => {
      const [mine, glob, board, versus, rank] = await Promise.all([
        supabase.from('game_sessions').select('mode, puzzle_date, guess_count, solved, is_archive'),
        supabase.rpc('global_stats'),
        supabase.rpc('daily_leaderboard', { p_date: todayUTC(), p_mode: null }),
        supabase.rpc('my_pvp_stats'),
        supabase.rpc('rating_leaderboard'),
      ])
      if (mine.error) setError(mine.error.message)
      setRows((mine.data as SessionRow[]) ?? [])
      setGlobal((glob.data as GlobalRow[]) ?? [])
      setLeaders((board.data as LeaderRow[]) ?? [])
      setPvp((versus.data as PvpStats) ?? null)
      setLadder((rank.data as RatingRow[]) ?? [])
    })()
  }, [user])

  // The standout games and per-set averages DO depend on it. Without this they
  // showed the same numbers under both tabs, which made the whole page look as
  // though Classic and Full were not separated at all.
  useEffect(() => {
    if (!user || !isConfigured) return
    void supabase
      .rpc('user_detail_stats', { p_username: null, p_mode: mode })
      .then(({ data }) => setDetail((data as DetailStats) ?? null))
  }, [user, mode])

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Stats need the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (authLoading) return <Centered><CircularProgress /></Centered>

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Stats
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to track streaks and see the leaderboard.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  if (!rows) return <Centered><CircularProgress /></Centered>

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Typography variant="h5">Stats</Typography>
      {error && <Alert severity="error">{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_, v: 'me' | 'everyone' | 'versus') => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab value="me" label="Dailies" />
        <Tab value="everyone" label="Everyone" />
        <Tab value="versus" label="Versus" />
      </Tabs>

      {tab === 'me' && (
        <MyStats rows={rows} detail={detail} mode={mode} setMode={setMode} leaders={leaders} />
      )}
      {tab === 'everyone' && <Everyone rows={global} />}
      {tab === 'versus' && <VersusStats stats={pvp} ladder={ladder} />}
    </Stack>
  )
}

function MyStats({
  rows,
  detail,
  mode,
  setMode,
  leaders,
}: {
  rows: SessionRow[]
  detail: DetailStats | null
  mode: DailyMode
  setMode: (m: DailyMode) => void
  leaders: LeaderRow[] | null
}) {
  const s = computeStats(rows, mode, todayUTC())
  const peak = Math.max(1, ...Object.values(s.distribution))
  const board = (leaders ?? []).filter((l) => l.mode === mode)

  return (
    <>
      <Tabs value={mode} onChange={(_, v: DailyMode) => setMode(v)} variant="fullWidth">
        <Tab value="classic" label="Classic" />
        <Tab value="full" label="Full" />
      </Tabs>

      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(auto-fit, minmax(110px, 1fr))' },
        }}
      >
        <Stat label="Played" value={s.played} />
        <Stat label="Win rate" value={s.played ? `${Math.round(s.winRate * 100)}%` : 'N/A'} />
        <Stat label="Streak" value={s.currentStreak} />
        <Stat label="Best streak" value={s.maxStreak} />
        <Stat label="Avg guesses" value={s.averageGuesses !== null ? s.averageGuesses.toFixed(1) : 'N/A'} />
        {detail && (
          <Stat
            label="Collected"
            value={`${detail.collected}/${detail.totalCharacters}`}
          />
        )}
      </Box>

      {detail && (detail.fastest || detail.toughest) && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography variant="subtitle2">Standout games</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {mode === 'classic' ? 'Classic' : 'Full'} only.
          </Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {detail.fastest && (
              <Highlight
                label="Fastest solve"
                characterId={detail.fastest.characterId}
                name={detail.fastest.name}
                detail={`${detail.fastest.seconds}s, ${detail.fastest.guesses} guesses`}
              />
            )}
            {detail.toughest && (
              <Highlight
                label="Toughest"
                characterId={detail.toughest.characterId}
                name={detail.toughest.name}
                detail={`${detail.toughest.guesses} guesses`}
              />
            )}
          </Stack>
        </Paper>
      )}

      {detail && detail.byScript.length > 0 && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Which sets you know best
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {mode === 'classic' ? 'Classic' : 'Full'} only. Average guesses per solve, lowest
            first.
          </Typography>
          <Table size="small">
            <TableBody>
              {detail.byScript.map((r) => (
                <TableRow key={r.script}>
                  <TableCell>{VALUE_LABELS[r.script] ?? r.script}</TableCell>
                  <TableCell align="right">{r.wins} solved</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {Number(r.avgGuesses).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Guess distribution
        </Typography>
        {s.wins === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No wins yet in this mode.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {DISTRIBUTION_BUCKETS.map((b) => {
              const n = s.distribution[b] ?? 0
              return (
                <Box key={b} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ width: 22, textAlign: 'right' }}>
                    {b}
                  </Typography>
                  <Box
                    sx={{
                      height: 20,
                      minWidth: n > 0 ? 26 : 4,
                      width: `${(n / peak) * 100}%`,
                      bgcolor: n > 0 ? 'success.main' : 'action.disabledBackground',
                      borderRadius: 0.75,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      px: 0.75,
                      transition: 'width 250ms ease',
                    }}
                  >
                    {n > 0 && (
                      <Typography variant="caption" sx={{ color: '#fff', fontWeight: 700 }}>
                        {n}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Stack>
        )}
      </Paper>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle2">Today</Typography>
        <Typography variant="caption" color="text.secondary">
          {todayUTC()}, {mode === 'classic' ? 'Classic' : 'Full'}
        </Typography>
        <Divider sx={{ my: 1 }} />
        {board.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nobody has finished today's puzzle yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Player</TableCell>
                <TableCell align="right">Guesses</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {board.map((l, i) => (
                <TableRow key={`${l.username}-${i}`}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <PlayerCell username={l.username} pronouns={l.pronouns} avatar={l.avatar} />
                  </TableCell>
                  <TableCell align="right">{l.solved ? l.guess_count : 'N/A'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </>
  )
}

function Everyone({ rows }: { rows: GlobalRow[] | null }) {
  if (!rows) return <Centered><CircularProgress /></Centered>
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
        No players yet.
      </Typography>
    )
  }

  const withGames = rows.filter((r) => r.wins > 0)
  const bestAverage = [...withGames]
    .filter((r) => r.avg_guesses !== null)
    .sort((a, b) => Number(a.avg_guesses) - Number(b.avg_guesses))[0]
  const mostCollected = [...rows].sort((a, b) => b.collected - a.collected)[0]
  const longestStreak = [...rows].sort((a, b) => b.best_streak - a.best_streak)[0]

  return (
    <>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
        <Award
          title="Best average"
          player={bestAverage}
          value={bestAverage?.avg_guesses != null ? Number(bestAverage.avg_guesses).toFixed(2) : 'N/A'}
          note="guesses per solve"
        />
        <Award
          title="Most characters"
          player={mostCollected}
          value={mostCollected ? String(mostCollected.collected) : 'N/A'}
          note="named at least once"
        />
        <Award
          title="Longest streak"
          player={longestStreak}
          value={longestStreak ? String(longestStreak.best_streak) : 'N/A'}
          note="consecutive days, either daily"
        />
      </Box>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Everyone
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Player</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  Played
                </TableCell>
                <TableCell align="right">Won</TableCell>
                <TableCell align="right">Avg</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  Streak
                </TableCell>
                <TableCell align="right">Owned</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.username}>
                  <TableCell>
                    <PlayerCell username={r.username} pronouns={r.pronouns} avatar={r.avatar} />
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    {r.played}
                  </TableCell>
                  <TableCell align="right">{r.wins}</TableCell>
                  <TableCell align="right">
                    {r.avg_guesses != null ? Number(r.avg_guesses).toFixed(2) : 'N/A'}
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    {r.best_streak}
                  </TableCell>
                  <TableCell align="right">{r.collected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </>
  )
}

function Award({
  title,
  player,
  value,
  note,
}: {
  title: string
  player?: GlobalRow
  value: string
  note: string
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 1.5, sm: 2 },
        textAlign: { xs: 'left', sm: 'center' },
        display: 'flex',
        flexDirection: { xs: 'row', sm: 'column' },
        alignItems: 'center',
        gap: { xs: 1.5, sm: 0 },
      }}
    >
      <EmojiEventsIcon sx={{ color: 'primary.main', flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {title}
        </Typography>
        <Typography variant="h5" sx={{ fontFamily: 'inherit', fontWeight: 700, lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {player?.username ?? 'Nobody yet'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </Box>
    </Paper>
  )
}

function PlayerCell({
  username,
  pronouns,
  avatar,
}: {
  username: string
  pronouns: string | null
  avatar: string | null
}) {
  const c = avatar ? BY_ID.get(avatar) : null
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Avatar
        src={c ? `${import.meta.env.BASE_URL}tokens/${c.image}` : undefined}
        sx={{ width: 26, height: 26, bgcolor: 'background.default', fontSize: 12 }}
      >
        {username[0]?.toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }}>
          {username}
        </Typography>
        {pronouns && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
            {pronouns}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}

function Highlight({
  label,
  characterId,
  name,
  detail,
}: {
  label: string
  characterId: string
  name: string
  detail: string
}) {
  const c = BY_ID.get(characterId)
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      {c && (
        <Box
          component="img"
          src={`${import.meta.env.BASE_URL}tokens/${c.image}`}
          alt=""
          width={44}
          height={44}
          sx={{ width: 44, height: 44 }}
        />
      )}
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      </Box>
    </Stack>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: { xs: 1, sm: 1.5 }, textAlign: 'center' }}>
      <Typography
        sx={{
          fontFamily: 'inherit',
          fontWeight: 700,
          // Long values such as "0/156" have to fit a third of a phone screen.
          fontSize: { xs: 17, sm: 24 },
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontSize: { xs: 10, sm: 12 }, lineHeight: 1.2, display: 'block' }}
      >
        {label}
      </Typography>
    </Paper>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>{children}</Box>
}
