import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ClueRow } from './compare'

export interface PvpPlayer {
  userId: string
  username: string
  pronouns: string | null
  /** Character id of their chosen profile token, if they have set one. */
  avatar: string | null
  score: number
  ready: boolean
  isHost: boolean
  isMe: boolean
}

export interface PvpGuess {
  id?: string
  name?: string
  clue?: ClueRow
  text?: string
}

export interface PvpRound {
  id: string
  kind: 'icon' | 'race' | 'assigned'
  cycle: number
  roundNo: number
  phase: 'picking' | 'playing'
  /** Shared reveal time. Both clients hold until this instant. */
  startsAt: string | null
  startedAt: string | null
  endsAt: string | null
  /** Server's view of whether the lead-in has elapsed. */
  live: boolean
  /** The database's clock, used to correct for a skewed local one. */
  serverNow: string
  iHavePicked: boolean
  myGuesses: PvpGuess[]
  myGuessCount: number
  mySolved: boolean
  myPoints: number
  myElapsedMs: number | null
  myFinished: boolean
  iconImage: string | null
  answerName: string | null
  answerId: string | null
  results: {
    userId: string
    points: number
    solved: boolean
    guessCount: number
    elapsedMs: number | null
    finished: boolean
  }[]
}

export interface PvpState {
  matchId: string
  joinCode: string
  status: 'lobby' | 'active' | 'finished' | 'abandoned'
  isHost: boolean
  config: { base3: boolean; experimental: boolean; travellers: boolean }
  cycles: number
  currentCycle: number
  currentRound: number
  players: PvpPlayer[]
  round: PvpRound | null
  /** Set once either player asks for a rematch; both follow it to the new match. */
  rematchId: string | null
  serverNow: string
}

/**
 * Live match state.
 *
 * Realtime tells us *that* something changed; we then re-read pvp_state rather
 * than trusting the payload, because the row contents are deliberately not what
 * a player may see -- pvp_state decides what to disclose and when.
 */
export function usePvp(matchId: string | null) {
  const [state, setState] = useState<PvpState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Local clock minus server clock, so countdowns agree between players. */
  const skewRef = useRef(0)

  const channelRef = useRef<RealtimeChannel | null>(null)

  /** Applies a state payload and re-syncs the clock offset. */
  const apply = useCallback((s: PvpState | null) => {
    if (!s) return
    const now = s.round?.serverNow ?? s.serverNow
    if (now) skewRef.current = Date.now() - Date.parse(now)
    setState(s)
    setError(null)
    setLoading(false)
  }, [])

  /**
   * Tells the other player to re-read, without waiting for the database's
   * replication stream. Broadcast does not touch Postgres, so it lands in a few
   * milliseconds where a postgres_changes event takes far longer.
   */
  const nudgePeer = useCallback(() => {
    void channelRef.current?.send({ type: 'broadcast', event: 'sync', payload: {} })
  }, [])

  const refresh = useCallback(async () => {
    if (!matchId) return
    const { data, error: err } = await supabase.rpc('pvp_state', { p_match: matchId })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    apply(data as unknown as PvpState)
  }, [matchId, apply])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime: any change to this match nudges a refetch.
  useEffect(() => {
    if (!matchId) return
    const channel = supabase.channel(`pvp:${matchId}`, {
      config: { broadcast: { self: false } },
    })
    const nudge = () => void refresh()

    channel
      // The fast path. Whoever acts pings this immediately after their RPC.
      .on('broadcast', { event: 'sync' }, nudge)
      // The reliable path, kept as a backstop in case a broadcast is missed.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_matches', filter: `id=eq.${matchId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_participants', filter: `match_id=eq.${matchId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pvp_rounds', filter: `match_id=eq.${matchId}` }, nudge)
      .subscribe()

    channelRef.current = channel
    return () => {
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [matchId, refresh])

  /**
   * Safety net: Realtime can drop silently, and a frozen match is far worse
   * than an occasional extra query.
   *
   * The interval is matched to what is actually at stake. A lobby changes only
   * when somebody clicks something, and the icon race is the one moment where a
   * second of staleness is felt. Polling every match every five seconds
   * regardless was pure waste on a free tier.
   */
  const status = state?.status
  const roundKind = state?.round?.kind
  useEffect(() => {
    if (!matchId || status === 'finished' || status === 'abandoned') return
    const interval = status === 'lobby' ? 3_000 : roundKind === 'icon' ? 2_000 : 5_000
    const id = setInterval(() => void refresh(), interval)
    return () => clearInterval(id)
  }, [matchId, status, roundKind, refresh])

  /**
   * Rounds advance without a scheduler: whichever client notices the clock has
   * run out asks the server to move on. pvp_advance is idempotent, so both
   * calling at once is harmless.
   */
  useEffect(() => {
    const round = state?.round
    if (!matchId || !round?.endsAt || state?.status !== 'active') return

    if (round.startsAt && Date.now() - skewRef.current < Date.parse(round.startsAt)) {
      // Still in the lead-in. Wake up when it ends so the round goes live on
      // time even if nothing else changes.
      const untilLive = Date.parse(round.startsAt) - (Date.now() - skewRef.current)
      const t = setTimeout(() => void refresh(), untilLive + 120)
      return () => clearTimeout(t)
    }

    const msLeft = Date.parse(round.endsAt) - (Date.now() - skewRef.current)
    const everyoneDone = round.results.length >= 2 && round.results.every((r) => r.finished)

    const advance = () =>
      void supabase.rpc('pvp_advance_state', { p_match: matchId }).then(({ data }) => {
        apply(data as unknown as PvpState)
        nudgePeer()
      })

    if (msLeft <= 0 || everyoneDone) {
      advance()
      return
    }
    const timer = setTimeout(advance, msLeft + 250)
    return () => clearTimeout(timer)
  }, [matchId, state?.round, state?.status, refresh, apply, nudgePeer])

  /**
   * Runs an action and applies the state it returns, rather than firing a
   * second request to find out what changed. The peer is nudged over broadcast
   * in the same tick.
   */
  const call = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      const { data, error: err } = await supabase.rpc(fn, args)
      if (err) {
        setError(err.message)
        return null
      }
      apply(data as unknown as PvpState)
      nudgePeer()
      return data
    },
    [apply, nudgePeer],
  )

  return {
    state,
    loading,
    error,
    refresh,
    clearError: () => setError(null),
    skewMs: skewRef.current,
    setReady: (ready: boolean) => call('pvp_set_ready', { p_match: matchId, p_ready: ready }),
    rematch: async () => {
      const { data, error: err } = await supabase.rpc('pvp_rematch', { p_match: matchId })
      if (err) {
        setError(err.message)
        return null
      }
      return (data as { matchId: string }).matchId
    },
    configure: (config: PvpState['config'], cycles: number) =>
      call('pvp_configure', { p_match: matchId, p_config: config, p_cycles: cycles }),
    start: () => call('pvp_start', { p_match: matchId }),
    assign: (roundId: string, characterId: string) =>
      call('pvp_assign', { p_round: roundId, p_character_id: characterId }),
    submitGuess: async (roundId: string, characterId: string) => {
      const { data, error: err } = await supabase.rpc('pvp_submit_guess_state', {
        p_round: roundId,
        p_guess_id: characterId,
      })
      if (err) {
        setError(err.message)
        return null
      }
      const payload = data as { result: unknown; state: PvpState }
      apply(payload.state)
      nudgePeer()
      return payload.result
    },
    // Not routed through `call`: the verdict is the return value and we do not
    // want a full state refetch between keystrokes in a 30-second race.
    submitIcon: async (roundId: string, text: string) => {
      const { data, error: err } = await supabase.rpc('pvp_submit_icon_guess', {
        p_round: roundId,
        p_text: text,
      })
      if (err) {
        setError(err.message)
        return null
      }
      const verdict = data as { verdict: string; points?: number; answerName?: string }
      // A correct answer changes the scoreboard for both players, so it is the
      // one icon-round outcome worth a round trip and a nudge.
      if (verdict.verdict === 'correct') {
        nudgePeer()
        await refresh()
      }
      return verdict
    },
  }
}
