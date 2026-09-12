import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { BY_ID } from '../data/pools'

/** Games below this are still provisional; K is higher and ratings swing. */
export const PROVISIONAL_GAMES = 10

export interface PvpStats {
  rating: number
  peak: number
  games: number
  wins: number
  losses: number
  draws: number
  provisional: boolean
  rank: number
  recent: {
    matchId: string
    opponent: string | null
    opponentAvatar: string | null
    score: number
    opponentScore: number
    outcome: 'win' | 'loss' | 'draw'
    ratingBefore: number | null
    ratingAfter: number | null
    finishedAt: string
  }[]
}

export interface RatingRow {
  username: string
  pronouns: string | null
  avatar: string | null
  rating: number
  peak_rating: number
  games: number
  wins: number
  losses: number
  draws: number
}

function token(id: string | null) {
  return id ? BY_ID.get(id) : null
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
  const c = token(avatar)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Avatar
        src={c ? `${import.meta.env.BASE_URL}tokens/${c.image}` : undefined}
        sx={{ width: 26, height: 26, bgcolor: 'background.default', fontSize: 12 }}
      >
        {username[0]?.toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }} noWrap>
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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: { xs: 1, sm: 1.5 }, textAlign: 'center' }}>
      <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: { xs: 17, sm: 24 } }}>
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

export function VersusStats({
  stats,
  ladder,
}: {
  stats: PvpStats | null
  ladder: RatingRow[] | null
}) {
  if (!stats) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const decided = stats.wins + stats.losses
  const winRate = decided > 0 ? Math.round((stats.wins / decided) * 100) : null

  return (
    <>
      <Paper elevation={0} sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Ranked rating
        </Typography>
        <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 44, lineHeight: 1.1 }}>
          {stats.rating}
        </Typography>
        {stats.provisional && (
          <Typography variant="caption" sx={{ color: 'warning.main', display: 'block' }}>
            Provisional
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {stats.games === 0
            ? 'Play a ranked match to get on the ladder.'
            : `Rank ${stats.rank}, peak ${stats.peak}`}
        </Typography>
        {stats.provisional && stats.games > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Ratings move faster for your first {PROVISIONAL_GAMES} games while they find your
            level. {PROVISIONAL_GAMES - stats.games} to go.
          </Typography>
        )}
      </Paper>

      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Played" value={stats.games} />
        <Stat label="Won" value={stats.wins} />
        <Stat label="Lost" value={stats.losses} />
        <Stat label="Win rate" value={winRate !== null ? `${winRate}%` : 'N/A'} />
      </Box>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Recent matches
        </Typography>
        {stats.recent.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No ranked matches yet.
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {stats.recent.map((m) => {
              const delta =
                m.ratingAfter !== null && m.ratingBefore !== null
                  ? m.ratingAfter - m.ratingBefore
                  : null
              const colour =
                m.outcome === 'win'
                  ? 'success.main'
                  : m.outcome === 'loss'
                    ? 'secondary.main'
                    : 'text.secondary'
              const c = token(m.opponentAvatar)
              return (
                <Stack key={m.matchId} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Avatar
                    src={c ? `${import.meta.env.BASE_URL}tokens/${c.image}` : undefined}
                    sx={{ width: 30, height: 30, bgcolor: 'background.default', fontSize: 13 }}
                  >
                    {m.opponent?.[0]?.toUpperCase() ?? '?'}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {m.opponent ?? 'Unknown'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {Math.round(m.score)} to {Math.round(m.opponentScore)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: colour, fontWeight: 700 }}>
                    {m.outcome === 'win' ? 'Win' : m.outcome === 'loss' ? 'Loss' : 'Draw'}
                  </Typography>
                  {delta !== null && (
                    <Typography
                      variant="body2"
                      sx={{ color: colour, fontWeight: 700, minWidth: 44, textAlign: 'right' }}
                    >
                      {delta >= 0 ? `+${delta}` : delta}
                    </Typography>
                  )}
                </Stack>
              )
            })}
          </Stack>
        )}
      </Paper>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Ladder
        </Typography>
        {!ladder || ladder.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nobody has played a ranked match yet.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Player</TableCell>
                  <TableCell align="right">Rating</TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    Peak
                  </TableCell>
                  <TableCell align="right">W/L</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ladder.map((r, i) => (
                  <TableRow key={r.username}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>
                      <PlayerCell username={r.username} pronouns={r.pronouns} avatar={r.avatar} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {r.rating}
                    </TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {r.peak_rating}
                    </TableCell>
                    <TableCell align="right">
                      {r.wins}/{r.losses}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </>
  )
}
