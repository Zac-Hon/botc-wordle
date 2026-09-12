import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

/**
 * The shared countdown before a round reveals.
 *
 * Rounds used to go live the instant they were created, so each player started
 * whenever their own update happened to arrive. Two browsers on one machine
 * made that gap very obvious, and in a thirty second race it decides the round.
 *
 * Now the server sets a reveal time a few seconds out and both clients hold
 * until it passes, using the server's clock rather than their own. Ordinary
 * delivery jitter disappears into the lead-in, and because scoring also starts
 * from the reveal time, a slow update cannot cost points either.
 */
export function LeadIn({
  startsAt,
  skewMs,
  label,
}: {
  startsAt: string
  skewMs: number
  label: string
}) {
  const [now, setNow] = useState(() => Date.now() - skewMs)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - skewMs), 80)
    return () => clearInterval(id)
  }, [skewMs])

  const left = Math.max(0, Date.parse(startsAt) - now)
  const seconds = Math.ceil(left / 1000)

  return (
    <Paper elevation={0} sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Box
        // Keyed on the second so each tick replays the pulse.
        key={seconds}
        sx={{
          fontFamily: 'inherit',
          fontSize: 72,
          fontWeight: 700,
          lineHeight: 1.1,
          color: 'primary.main',
          animation: 'pulse 600ms ease-out',
          '@keyframes pulse': {
            from: { transform: 'scale(1.4)', opacity: 0.2 },
            to: { transform: 'scale(1)', opacity: 1 },
          },
        }}
      >
        {seconds > 0 ? seconds : 'Go'}
      </Box>
      <Typography variant="body2" color="text.secondary">
        Both players start together.
      </Typography>
    </Paper>
  )
}
