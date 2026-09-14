import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Avatar from '@mui/material/Avatar'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { ALL_CHARACTERS, BY_ID } from '../data/pools'
import { frameSx } from '../game/frames'
import { tokenSrc } from '../lib/tokens'
import { GuessInput } from '../components/GuessInput'
import { DeductionRound } from '../components/pvp/DeductionRound'
import { IconRound } from '../components/pvp/IconRound'
import { LeadIn } from '../components/pvp/LeadIn'
import { usePvp, type PvpState } from '../game/usePvp'
import type { Character } from '../game/types'

export function PvpMatch() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const pvp = usePvp(matchId ?? null)
  const { state } = pvp

  // If the opponent opened a rematch, follow them into it rather than leaving
  // the two of you sitting in separate lobbies.
  useEffect(() => {
    if (state?.rematchId && state.status === 'finished') {
      navigate(`/pvp/${state.rematchId}`, { replace: true })
    }
  }, [state?.rematchId, state?.status, navigate])

  const pool = useMemo<Character[]>(() => {
    const cfg = state?.config
    if (!cfg) return []
    return ALL_CHARACTERS.filter((c) => {
      if (c.pools.isStoryteller) return false
      if (c.pools.isTraveller) return cfg.travellers
      if (c.pools.inBase3) return cfg.base3
      if (c.pools.isExperimental) return cfg.experimental
      return false
    })
  }, [state?.config])

  if (pvp.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!state) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {pvp.error ?? 'Match not found.'}{' '}
        <RouterLink to="/pvp">Back to Versus</RouterLink>
      </Alert>
    )
  }

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      {pvp.error && (
        <Alert severity="error" onClose={pvp.clearError}>
          {pvp.error}
        </Alert>
      )}

      <Scoreboard state={state} />

      {state.status === 'lobby' && !state.ranked && <Lobby state={state} pvp={pvp} />}

      {state.status === 'active' && state.round && !state.round.live && state.round.startsAt && (
        <LeadIn
          startsAt={state.round.startsAt}
          skewMs={pvp.skewMs}
          label={
            state.round.kind === 'icon'
              ? 'Round 1 starts in'
              : `Round ${state.round.roundNo} starts in`
          }
        />
      )}

      {state.status === 'active' && state.round && state.round.live && (
        <>
          {state.round.kind === 'icon' && (
            <IconRound
              round={state.round}
              skewMs={pvp.skewMs}
              onSubmit={(text) => pvp.submitIcon(state.round!.id, text)}
            />
          )}

          {(state.round.kind === 'race' ||
            (state.round.kind === 'assigned' && state.round.phase === 'playing')) && (
            <DeductionRound
              round={state.round}
              pool={pool}
              skewMs={pvp.skewMs}
              onGuess={(id) => void pvp.submitGuess(state.round!.id, id)}
            />
          )}
        </>
      )}

      {/* Picking happens before the clock starts, so it is not gated on live. */}
      {state.status === 'active' &&
        state.round?.kind === 'assigned' &&
        state.round.phase === 'picking' && (
          <PickForOpponent state={state} pvp={pvp} pool={pool} />
        )}

      {state.status === 'finished' && <Finished state={state} pvp={pvp} />}
    </Stack>
  )
}

function Scoreboard({ state }: { state: PvpState }) {
  const leader = Math.max(0, ...state.players.map((p) => p.score))
  return (
    <Paper elevation={0} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="subtitle2" color="text.secondary">
          {state.status === 'lobby'
            ? 'Lobby'
            : state.status === 'finished'
              ? 'Final score'
              : `Cycle ${state.currentCycle} of ${state.cycles} · Round ${state.currentRound} of 3`}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {state.ranked ? (
          <Chip size="small" color="primary" label="Ranked" />
        ) : (
          <Chip size="small" variant="outlined" label={`Code ${state.joinCode}`} />
        )}
      </Stack>

      <Stack spacing={1}>
        {state.players.map((p) => {
          // This row carries more than a PlayerChip does (the ready state, the
          // running score, and marking which one is you), so it uses the same
          // primitives rather than the component.
          const caption = [
            p.title,
            p.pronouns,
            state.ranked && p.rating !== null ? `${p.rating}` : null,
            !state.ranked && p.isHost ? 'host' : null,
          ].filter(Boolean)
          return (
          <Box key={p.userId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{ ...frameSx(p.frame), borderRadius: '50%', p: '2px', display: 'inline-flex' }}
            >
              <Avatar
                src={tokenSrc(p.avatar)}
                sx={{ width: 32, height: 32, bgcolor: 'background.default', fontSize: 14 }}
              >
                {p.username[0]?.toUpperCase()}
              </Avatar>
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                noWrap
                component={RouterLink}
                to={`/player/${encodeURIComponent(p.username)}`}
                sx={{
                  fontWeight: p.isMe ? 700 : 400,
                  lineHeight: 1.2,
                  color: 'inherit',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                  display: 'block',
                }}
              >
                {p.username}
                {p.isMe && ' (you)'}
              </Typography>
              {caption.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                  {caption.join(' · ')}
                </Typography>
              )}
            </Box>
            {state.status === 'lobby' && (
              <Chip size="small" color={p.ready ? 'success' : 'default'} label={p.ready ? 'Ready' : 'Not ready'} />
            )}
            <Typography
              variant="h6"
              sx={{
                fontFamily: 'inherit',
                fontWeight: 700,
                color: p.score >= leader && leader > 0 ? 'primary.main' : 'text.primary',
                minWidth: 48,
                textAlign: 'right',
              }}
            >
              {Math.round(p.score)}
            </Typography>
          </Box>
          )
        })}
        {state.players.length < 2 && (
          <Typography variant="body2" color="text.secondary">
            Waiting for an opponent…
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

function Lobby({ state, pvp }: { state: PvpState; pvp: ReturnType<typeof usePvp> }) {
  const [copied, setCopied] = useState(false)
  const me = state.players.find((p) => p.isMe)
  const bothHere = state.players.length >= 2
  const bothReady = bothHere && state.players.every((p) => p.ready)

  const setConfig = (key: keyof PvpState['config']) => {
    void pvp.configure({ ...state.config, [key]: !state.config[key] }, state.cycles)
  }

  return (
    <Paper elevation={0} sx={{ p: { xs: 1.75, sm: 2.5 } }}>
      <Typography variant="subtitle1" gutterBottom>
        Invite your opponent
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
        <Typography
          sx={{
            letterSpacing: { xs: 3, sm: 6 },
            fontSize: { xs: 26, sm: 34 },
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            color: 'primary.main',
          }}
        >
          {state.joinCode}
        </Typography>
        <Button
          size="small"
          startIcon={<ContentCopyIcon />}
          onClick={() => {
            void navigator.clipboard.writeText(state.joinCode).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Stack>

      {state.isHost ? (
        <>
          <Typography variant="subtitle2" gutterBottom>
            Which characters?
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            <FormControlLabel
              control={<Switch size="small" checked={state.config.base3} onChange={() => setConfig('base3')} />}
              label={<Typography variant="body2">Base 3</Typography>}
            />
            <FormControlLabel
              control={
                <Switch size="small" checked={state.config.experimental} onChange={() => setConfig('experimental')} />
              }
              label={<Typography variant="body2">Experimental</Typography>}
            />
            <FormControlLabel
              control={
                <Switch size="small" checked={state.config.travellers} onChange={() => setConfig('travellers')} />
              }
              label={<Typography variant="body2">Travellers</Typography>}
            />
          </Box>

          <TextField
            select
            size="small"
            label="Cycles"
            value={state.cycles}
            onChange={(e) => void pvp.configure(state.config, Number(e.target.value))}
            helperText="Each cycle is all three rounds"
            sx={{ mb: 1.5, minWidth: 160 }}
          >
            {[1, 2, 3].map((n) => (
              <MenuItem key={n} value={n}>
                {n} {n === 1 ? 'cycle' : 'cycles'} ({n * 3} rounds)
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ mb: 2 }}>
            <SettingsSummary state={state} />
          </Box>
        </>
      ) : (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Settings
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Chosen by {state.players.find((p) => p.isHost)?.username ?? 'the host'}. These update
            live if they change them.
          </Typography>
          <SettingsSummary state={state} />
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Button variant={me?.ready ? 'outlined' : 'contained'} onClick={() => void pvp.setReady(!me?.ready)}>
          {me?.ready ? 'Not ready' : "I'm ready"}
        </Button>
        {state.isHost && (
          <Button variant="contained" color="primary" disabled={!bothReady} onClick={() => void pvp.start()}>
            Start match
          </Button>
        )}
      </Stack>

      {state.isHost && !bothReady && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {bothHere ? 'Both players must be ready.' : 'Waiting for your opponent to join.'}
        </Typography>
      )}
    </Paper>
  )
}

/** What the match is actually set to, shown identically to both players. */
function SettingsSummary({ state }: { state: PvpState }) {
  const pools = [
    state.config.base3 && 'Base 3',
    state.config.experimental && 'Experimental',
    state.config.travellers && 'Travellers',
  ].filter(Boolean) as string[]

  const pool = ALL_CHARACTERS.filter((c) => {
    if (c.pools.isStoryteller) return false
    if (c.pools.isTraveller) return state.config.travellers
    if (c.pools.inBase3) return state.config.base3
    if (c.pools.isExperimental) return state.config.experimental
    return false
  }).length

  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }} useFlexGap>
      {pools.length > 0 ? (
        pools.map((p) => <Chip key={p} size="small" color="primary" variant="outlined" label={p} />)
      ) : (
        <Chip size="small" color="warning" variant="outlined" label="No sets chosen" />
      )}
      <Chip size="small" variant="outlined" label={`${pool} characters`} />
      <Chip
        size="small"
        variant="outlined"
        label={`${state.cycles} ${state.cycles === 1 ? 'cycle' : 'cycles'}, ${state.cycles * 3} rounds`}
      />
    </Stack>
  )
}

function PickForOpponent({
  state,
  pvp,
  pool,
}: {
  state: PvpState
  pvp: ReturnType<typeof usePvp>
  pool: Character[]
}) {
  const opponent = state.players.find((p) => !p.isMe)
  const opponentToken = opponent?.avatar ? BY_ID.get(opponent.avatar) : null
  const picked = state.round?.iHavePicked

  return (
    <Paper elevation={0} sx={{ p: 2.5 }}>
      <Typography variant="overline" color="text.secondary">
        Round 3 · Set a character
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        {opponentToken && (
          <Box
            component="img"
            src={tokenSrc(opponentToken)}
            alt=""
            width={40}
            height={40}
            sx={{ width: 40, height: 40 }}
          />
        )}
        <Typography variant="h6">
          Choose the character {opponent?.username ?? 'your opponent'} has to find
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        They are choosing one for you at the same time. The round starts once you have both picked.
      </Typography>

      {picked ? (
        <Alert severity="success">Your pick is in. Waiting for your opponent…</Alert>
      ) : (
        <Box sx={{ pb: '300px' }}>
          <GuessInput
            pool={pool}
            guessed={new Set()}
            onGuess={(c) => void pvp.assign(state.round!.id, c.id)}
          />
        </Box>
      )}
    </Paper>
  )
}

function Finished({ state, pvp }: { state: PvpState; pvp: ReturnType<typeof usePvp> }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const sorted = [...state.players].sort((a, b) => b.score - a.score)
  const [top, second] = sorted
  const draw = second && top.score === second.score
  const iWon = !draw && top?.isMe

  return (
    <Paper
      elevation={0}
      sx={{ p: 3, textAlign: 'center', borderColor: iWon ? 'success.main' : 'divider', borderWidth: 1, borderStyle: 'solid' }}
    >
      <Typography variant="h4" gutterBottom>
        {draw ? 'A draw' : iWon ? 'You win' : `${top?.username} wins`}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        {sorted.map((p) => `${p.username} ${Math.round(p.score)}`).join(' · ')}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap' }} useFlexGap>
        {!state.ranked && (
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const id = await pvp.rematch()
              setBusy(false)
              if (id) navigate(`/pvp/${id}`)
            }}
          >
            {busy ? 'Setting up...' : 'Rematch'}
          </Button>
        )}
        <Button variant={state.ranked ? 'contained' : 'text'} component={RouterLink} to="/pvp">
          {state.ranked ? 'Queue again' : 'New opponent'}
        </Button>
      </Stack>
    </Paper>
  )
}
