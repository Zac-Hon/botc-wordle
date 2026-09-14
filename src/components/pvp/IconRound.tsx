import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { RoundTimer } from './RoundTimer'
import type { PvpRound } from '../../game/usePvp'

type Verdict = { verdict: string; points?: number; answerName?: string } | null

/** Wrong guesses allowed at full speed before the input is throttled. */
const FREE_GUESSES = 5
/** How long a throttled player waits between attempts. */
const THROTTLE_MS = 1000

/**
 * Round one: name the character from its token art, fastest scores most.
 *
 * A near-miss spelling is told it is near and nothing else -- the correct
 * spelling is never shown, so the player still has to produce it. Wrong guesses
 * cost nothing, but after five the input is rate limited, because otherwise the
 * optimal strategy is to paste names as fast as the network allows.
 */
export function IconRound({
  round,
  skewMs,
  onSubmit,
}: {
  round: PvpRound
  skewMs: number
  onSubmit: (text: string) => Promise<Verdict>
}) {
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState<'close' | 'wrong' | null>(null)
  const [wrongCount, setWrongCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const lastSubmit = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [round.id])

  const done = round.mySolved || round.myFinished
  // Must come from the server's view of MY row -- results[] holds both players.
  const elapsedLabel =
    round.mySolved && round.myElapsedMs != null
      ? `${(round.myElapsedMs / 1000).toFixed(1)}s`
      : null
  // Held in state, not computed during render. Reading Date.now() and a ref
  // while rendering meant nothing re-rendered when the second elapsed, so the
  // warning stuck on screen and `submit` tested a stale value that could both
  // block a legitimate guess and let a rapid one through.
  const [throttled, setThrottled] = useState(false)

  useEffect(() => {
    if (!throttled) return
    const t = setTimeout(() => setThrottled(false), THROTTLE_MS)
    return () => clearTimeout(t)
  }, [throttled])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Checked at call time rather than from render state, so the decision is
    // made against the real clock.
    const since = Date.now() - lastSubmit.current
    if (!text.trim() || busy || done) return
    if (wrongCount >= FREE_GUESSES && since < THROTTLE_MS) {
      setThrottled(true)
      return
    }
    setBusy(true)
    lastSubmit.current = Date.now()

    const result = await onSubmit(text)
    setBusy(false)

    if (!result) return
    if (result.verdict === 'correct') {
      setFeedback(null)
      setText('')
      return
    }
    if (result.verdict === 'close') {
      setFeedback('close')
    } else {
      setFeedback('wrong')
      setWrongCount((n) => n + 1)
    }
    // Clear the box either way: retyping is part of the race.
    setText('')
    setTimeout(() => setFeedback(null), 1600)
  }

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, textAlign: 'center' }}>
        <Typography variant="overline" color="text.secondary">
          Round {round.roundNo} · Name this character
        </Typography>

        {round.iconImage && (
          <Box
            component="img"
            src={`${import.meta.env.BASE_URL}tokens/${round.iconImage}`}
            alt="Character token"
            sx={{
              width: { xs: 130, sm: 180 },
              height: { xs: 130, sm: 180 },
              mx: 'auto',
              display: 'block',
              my: 1.5,
            }}
          />
        )}

        {round.endsAt && !done && (
          <Box sx={{ maxWidth: 320, mx: 'auto', mb: 2 }}>
            <RoundTimer endsAt={round.endsAt} startedAt={round.startedAt} skewMs={skewMs} />
          </Box>
        )}

        {done ? (
          <Alert severity={round.mySolved ? 'success' : 'info'} sx={{ textAlign: 'left' }}>
            {round.mySolved
              ? `Got it, ${Math.round(round.myPoints)} points${
                  elapsedLabel ? ` in ${elapsedLabel}` : ''
                }`
              : 'Out of time.'}
            {round.answerName && ` It was the ${round.answerName}.`}
          </Alert>
        ) : (
          <Box component="form" onSubmit={submit}>
            <Stack direction="row" spacing={1} sx={{ maxWidth: 420, mx: 'auto' }}>
              <TextField
                inputRef={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type the name…"
                size="small"
                fullWidth
                autoComplete="off"
                disabled={busy}
              />
              <Button type="submit" variant="contained" disabled={busy || !text.trim()}>
                Guess
              </Button>
            </Stack>
          </Box>
        )}

        {feedback === 'close' && (
          <Typography sx={{ mt: 1.5, color: 'warning.main', fontWeight: 700 }}>
            So close! Check your spelling.
          </Typography>
        )}
        {feedback === 'wrong' && (
          <Typography sx={{ mt: 1.5, color: 'text.secondary' }}>Not that one.</Typography>
        )}
        {throttled && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Slow down a moment…
          </Typography>
        )}
      </Paper>
    </Stack>
  )
}
