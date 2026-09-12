import { createTheme, type ThemeOptions } from '@mui/material/styles'

/**
 * Clocktower-ish palette: deep night blue ground, candlelit parchment text,
 * blood red for evil and emphasis.
 *
 * The three clue colours are the load-bearing part. They are chosen to stay
 * distinguishable for the common forms of colour blindness, but the grid never
 * relies on colour alone -- every cell also carries a glyph. See ClueCell.
 */
export const CLUE_COLORS = {
  match: '#3f8f4f',
  matchText: '#ffffff',
  partial: '#b8892b',
  partialText: '#1a1a14',
  miss: '#3a3f4d',
  missText: '#c9cdd6',
} as const

const options: ThemeOptions = {
  palette: {
    mode: 'dark',
    background: {
      default: '#10131c',
      paper: '#181c28',
    },
    primary: {
      main: '#c8a951',
      contrastText: '#14161f',
    },
    secondary: {
      main: '#a3282c',
    },
    success: { main: CLUE_COLORS.match },
    warning: { main: CLUE_COLORS.partial },
    text: {
      primary: '#ece6d8',
      secondary: '#9aa0b0',
    },
    divider: 'rgba(200, 169, 81, 0.18)',
  },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400, letterSpacing: '0.02em' },
    h2: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400 },
    h3: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400 },
    h4: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400 },
    h5: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400 },
    h6: { fontFamily: '"IM Fell English", Georgia, serif', fontWeight: 400 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            'radial-gradient(1200px 600px at 50% -10%, rgba(200,169,81,0.09), transparent 60%)',
          backgroundAttachment: 'fixed',
          minHeight: '100dvh',
        },
        // Respect a player's reduced-motion preference; the grid animates a lot.
        '@media (prefers-reduced-motion: reduce)': {
          '*': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: '1px solid rgba(200,169,81,0.12)' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
  },
}

export const theme = createTheme(options)
