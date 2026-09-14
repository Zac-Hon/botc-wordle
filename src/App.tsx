import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import CssBaseline from '@mui/material/CssBaseline'
import IconButton from '@mui/material/IconButton'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded'
import { ThemeProvider } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import useMediaQuery from '@mui/material/useMediaQuery'
import { AccountMenu } from './components/AccountMenu'
import { HelpDialog } from './components/HelpDialog'
import { MobileNav } from './components/MobileNav'
import { NAV_ITEMS } from './components/navItems'
import { useAuth } from './store/auth'
import { theme } from './theme/theme'

/**
 * Routes are split so a first load only pays for what it shows.
 *
 * MUI is large, and pulling Stats, Collection, Archive and the whole of Versus
 * into the initial bundle made every visitor download code for pages most of
 * them never open. Home and the dailies are what people arrive for.
 */
const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const Daily = lazy(() => import('./routes/Daily').then((m) => ({ default: m.Daily })))
const Endless = lazy(() => import('./routes/Endless').then((m) => ({ default: m.Endless })))
const SignIn = lazy(() => import('./routes/SignIn').then((m) => ({ default: m.SignIn })))
const Stats = lazy(() => import('./routes/Stats').then((m) => ({ default: m.Stats })))
const Archive = lazy(() => import('./routes/Archive').then((m) => ({ default: m.Archive })))
const ArchivePlay = lazy(() =>
  import('./routes/ArchivePlay').then((m) => ({ default: m.ArchivePlay })),
)
const Collection = lazy(() =>
  import('./routes/Collection').then((m) => ({ default: m.Collection })),
)
const Profile = lazy(() => import('./routes/Profile').then((m) => ({ default: m.Profile })))
const PlayerProfile = lazy(() =>
  import('./routes/PlayerProfile').then((m) => ({ default: m.PlayerProfile })),
)
const Achievements = lazy(() =>
  import('./routes/Achievements').then((m) => ({ default: m.Achievements })),
)
const Pvp = lazy(() => import('./routes/Pvp').then((m) => ({ default: m.Pvp })))
const PvpMatch = lazy(() => import('./routes/PvpMatch').then((m) => ({ default: m.PvpMatch })))

function DesktopNav() {
  const { pathname } = useLocation()
  // Falls back to false rather than a wrong index, so MUI does not warn on
  // routes that are not tabs (sign-in, profile, stats).
  const current = NAV_ITEMS.find((n) => pathname.startsWith(n.to))?.to ?? false

  return (
    <Tabs value={current} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
      {NAV_ITEMS.map((n) => (
        <Tab key={n.to} value={n.to} label={n.label} component={NavLink} to={n.to} />
      ))}
    </Tabs>
  )
}

function RouteFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  )
}

export default function App() {
  const init = useAuth((s) => s.init)
  const [helpOpen, setHelpOpen] = useState(false)
  // 900px: below this the seven tabs cannot sit on one line with the title.
  const compact = useMediaQuery('(max-width:899px)')

  // Subscribes to auth changes for the life of the app; init returns its own
  // unsubscribe so StrictMode's double-invoke does not leak a listener.
  useEffect(() => init(), [init])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={{ backdropFilter: 'blur(8px)' }}
      >
        {/* One row on a phone. Wrapping put the title, the tabs and the account
            button on three separate lines and cost a third of the screen. */}
        <Toolbar sx={{ gap: 0.5, minHeight: { xs: 56, md: 64 }, px: { xs: 1, sm: 2 } }}>
          {compact && <MobileNav items={NAV_ITEMS} />}

          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            noWrap
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              fontSize: { xs: 18, sm: 20 },
              mr: 1,
            }}
          >
            Clocktowerdle
          </Typography>

          {!compact && <DesktopNav />}

          <Box sx={{ flex: 1 }} />

          <Tooltip title="How to play">
            <IconButton size="small" onClick={() => setHelpOpen(true)} aria-label="How to play">
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
          <AccountMenu compact={compact} />
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: { xs: 1.5, sm: 2 }, px: { xs: 1.5, sm: 3 } }}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/daily/classic" element={<Daily mode="classic" />} />
            <Route path="/daily/full" element={<Daily mode="full" />} />
            <Route path="/endless" element={<Endless />} />
            <Route path="/signin" element={<SignIn mode="in" />} />
            <Route path="/signup" element={<SignIn mode="up" />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/player/:username" element={<PlayerProfile />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/archive/:mode/:date" element={<ArchivePlay />} />
            <Route path="/pvp" element={<Pvp />} />
            <Route path="/pvp/:matchId" element={<PvpMatch />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Container>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </ThemeProvider>
  )
}
