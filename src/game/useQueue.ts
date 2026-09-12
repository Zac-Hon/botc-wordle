import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type QueueStatus = 'idle' | 'queued' | 'matched'

export interface QueueState {
  status: QueueStatus
  matchId: string | null
  rating: number | null
  waitedSeconds: number
  tolerance: number | null
}

/** How often to ask the server to look for an opponent. */
const POLL_MS = 2000

/**
 * Ranked matchmaking.
 *
 * There is no scheduler on the free tier, so nothing runs a matchmaker in the
 * background. Pairing happens inside queue_join and queue_poll instead, which
 * means the act of waiting is what drives matchmaking: every poll is also a
 * matchmaking tick. Two players polling cannot claim each other twice because
 * the pairing query takes a row lock.
 */
export function useQueue() {
  const [state, setState] = useState<QueueState>({
    status: 'idle',
    matchId: null,
    rating: null,
    waitedSeconds: 0,
    tolerance: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('queue_poll')
    if (err) {
      setError(err.message)
      return
    }
    const r = data as {
      status: QueueStatus
      matchId?: string
      waitedSeconds?: number
      tolerance?: number
    }
    setState((prev) => ({
      status: r.status,
      matchId: r.matchId ?? null,
      rating: prev.rating,
      waitedSeconds: r.waitedSeconds ?? prev.waitedSeconds,
      tolerance: r.tolerance ?? prev.tolerance,
    }))
    if (r.status === 'matched' || r.status === 'idle') stopPolling()
  }, [stopPolling])

  const join = useCallback(async () => {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('queue_join')
    setBusy(false)
    if (err) {
      setError(err.message)
      return null
    }
    const r = data as { status: QueueStatus; matchId?: string; rating?: number }
    setState({
      status: r.status,
      matchId: r.matchId ?? null,
      rating: r.rating ?? null,
      waitedSeconds: 0,
      tolerance: null,
    })

    if (r.status === 'queued' && !pollRef.current) {
      pollRef.current = setInterval(() => void poll(), POLL_MS)
    }
    return r.matchId ?? null
  }, [poll])

  const leave = useCallback(async () => {
    stopPolling()
    await supabase.rpc('queue_leave')
    setState((prev) => ({ ...prev, status: 'idle', matchId: null, waitedSeconds: 0 }))
  }, [stopPolling])

  // Leaving the page should not leave a ghost sitting in the queue for other
  // players to match against and then find nobody there.
  useEffect(() => {
    return () => {
      stopPolling()
      void supabase.rpc('queue_leave')
    }
  }, [stopPolling])

  return { ...state, error, busy, join, leave, poll, clearError: () => setError(null) }
}
