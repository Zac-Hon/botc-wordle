import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import AllInclusiveIcon from '@mui/icons-material/AllInclusive'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import HistoryIcon from '@mui/icons-material/History'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import SportsKabaddiIcon from '@mui/icons-material/SportsKabaddi'
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech'
import { Link as RouterLink } from 'react-router-dom'
import { CLASSIC_POOL, FULL_POOL } from '../data/pools'
import { useAuth } from '../store/auth'

interface Tile {
  to: string
  title: string
  blurb: string
  icon: React.ReactNode
  chip?: string
  accent?: boolean
  disabled?: boolean
}

export function Home() {
  const { user, username } = useAuth()

  const tiles: Tile[] = [
    {
      to: '/daily/classic',
      title: 'Daily Classic',
      blurb: 'Trouble Brewing, Bad Moon Rising and Sects & Violets.',
      icon: <CalendarMonthIcon fontSize="large" />,
      chip: `${CLASSIC_POOL.length} characters`,
      accent: true,
    },
    {
      to: '/daily/full',
      title: 'Daily Full',
      blurb: 'Every player character, experimentals included. Harder.',
      icon: <WhatshotIcon fontSize="large" />,
      chip: `${FULL_POOL.length} characters`,
      accent: true,
    },
    {
      to: '/endless',
      title: 'Endless',
      blurb: 'Play as many as you like. Choose your own pools.',
      icon: <AllInclusiveIcon fontSize="large" />,
      chip: 'No account needed',
    },
    {
      to: '/collection',
      title: 'Collection',
      blurb: 'Every character you have named, laid out by set.',
      icon: <CollectionsBookmarkIcon fontSize="large" />,
    },
    {
      to: '/archive',
      title: 'Archive',
      blurb: 'Replay any puzzle you missed. Does not affect your streak.',
      icon: <HistoryIcon fontSize="large" />,
    },
    {
      to: '/achievements',
      title: 'Achievements',
      blurb: 'Milestones that unlock titles and frames for your avatar.',
      icon: <MilitaryTechIcon fontSize="large" />,
    },
    {
      to: '/stats',
      title: 'Stats',
      blurb: 'Streaks, win rate and your guess distribution.',
      icon: <QueryStatsIcon fontSize="large" />,
    },
    {
      to: '/pvp',
      title: 'Versus',
      blurb: 'Queue for a ranked match, or play a friend with a code.',
      icon: <SportsKabaddiIcon fontSize="large" />,
      chip: 'Ranked',
    },
  ]

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h4" gutterBottom>
          {user ? `Welcome back, ${username ?? 'player'}` : 'Clocktowerdle'}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Name the hidden Blood on the Clocktower character. Every guess narrows it down.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
        }}
      >
        {tiles.map((t) => (
          <Paper
            key={t.to}
            elevation={0}
            component={t.disabled ? 'div' : RouterLink}
            {...(t.disabled ? {} : { to: t.to })}
            aria-disabled={t.disabled || undefined}
            sx={{
              p: 2.5,
              display: 'flex',
              gap: 2,
              alignItems: 'flex-start',
              textDecoration: 'none',
              color: 'text.primary',
              borderColor: t.accent ? 'primary.main' : undefined,
              opacity: t.disabled ? 0.45 : 1,
              pointerEvents: t.disabled ? 'none' : undefined,
              transition: 'transform 140ms ease, border-color 140ms ease',
              '&:hover': t.disabled
                ? undefined
                : { transform: 'translateY(-2px)', borderColor: 'primary.main' },
            }}
          >
            <Box sx={{ color: t.accent ? 'primary.main' : 'text.secondary', mt: 0.25 }}>
              {t.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                {t.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: t.chip ? 1 : 0 }}>
                {t.blurb}
              </Typography>
              {t.chip && <Chip size="small" variant="outlined" label={t.chip} />}
            </Box>
          </Paper>
        ))}
      </Box>

      {!user && (
        <Typography variant="body2" color="text.secondary" align="center">
          Endless works without an account. The dailies need one so your streak and the
          leaderboard can be tracked.
        </Typography>
      )}
    </Stack>
  )
}
