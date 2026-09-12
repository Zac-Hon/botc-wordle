import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'

/**
 * Counts down to a server-supplied deadline.
 *
 * `skewMs` corrects for a local clock that disagrees with the database, so both
 * players see the same number rather than one of them getting a phantom extra
 * few seconds. The server rejects late submissions regardless -- this is
 * display only.
 */
export function RoundTimer({
  endsAt,
  startedAt,
  skewMs,
  label,
}: {
  endsAt: string
  startedAt: string | null
  skewMs: number
  label?: string
}) {
  const [now, setNow] = useState(() => Date.now() - skewMs)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - skewMs), 100)
    return () => clearInterval(id)
  }, [skewMs])

  const end = Date.parse(endsAt)
  const start = startedAt ? Date.parse(startedAt) : end - 30_000
  const total = Math.max(1, end - start)
  const left = Math.max(0, end - now)
  const pct = Math.max(0, Math.min(100, (left / total) * 100))
  const seconds = Math.ceil(left / 1000)

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label ?? 'Time left'}
        </Typography>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, color: seconds <= 5 ? 'secondary.main' : 'text.secondary' }}
        >
          {seconds}s
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={pct < 25 ? 'secondary' : 'primary'}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  )
}
