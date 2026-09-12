import { useCallback, useEffect, useMemo, useState } from 'react'
import { BY_ID } from '../data/pools'
import { supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import { revealHangman } from './hangman'
import type { ClueRow } from './compare'
import type { Character } from './types'
import type { GuessEntry } from '../components/GuessGrid'
import type { DailyMode } from './daily'

/** What submit_daily_guess returns. The answer id appears only on a solve. */
interface GuessResponse {
  clue: ClueRow
  guessId: string
  guessName: string
  solved: boolean
  guessCount: number
  wrongCount: number
  /** Sent once the hangman has been earned, or on a solve. Never before. */
  answerName: string | null
  answerId: string | null
}

interface SessionResponse {
  sessionId: string
  guesses: { id: string; name: string; clue: ClueRow }[]
  guessCount: number
  wrongCount: number
  solved: boolean
  gaveUp: boolean
  isArchive: boolean
  /** Re-issued on resume once earned, so a page reload keeps the hangman. */
  answerName: string | null
  answerId: string | null
}

/**
 * Daily game state, backed by the database.
 *
 * Unlike Endless, nothing here derives the answer locally: the client sends a
 * guess id and receives a clue row. The answer's *name* arrives only once the
 * hangman opens (4 wrong guesses), and its identity only on a solve or a
 * give-up. That is the whole reason the dailies go through RPCs.
 */
export function useDailyGame(mode: DailyMode, date?: string) {
  const handleStaleSession = useAuth((s) => s.handleStaleSession)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<GuessEntry[]>([])
  const [solved, setSolved] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [answerName, setAnswerName] = useState<string | null>(null)
  const [answer, setAnswer] = useState<Character | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const toEntry = useCallback(
    (g: { id: string; name: string; clue: ClueRow }): GuessEntry => ({
      id: g.id,
      name: g.name,
      image: BY_ID.get(g.id)?.image ?? `${g.id}.webp`,
      clue: g.clue,
    }),
    [],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .rpc('start_daily', { p_mode: mode, p_date: date ?? null })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          if (handleStaleSession(err)) return
          setError(err.message)
          setLoading(false)
          return
        }
        const s = data as unknown as SessionResponse
        setSessionId(s.sessionId)
        setGuesses((s.guesses ?? []).map(toEntry))
        setSolved(s.solved)
        setGaveUp(s.gaveUp)
        setAnswer(s.answerId ? (BY_ID.get(s.answerId) ?? null) : null)
        setAnswerName(s.answerName ?? null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mode, date, toEntry, handleStaleSession])

  const finished = solved || gaveUp
  const wrongCount = guesses.length - (solved ? 1 : 0)
  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.id)), [guesses])

  // Built from the name the server released, so before 4 wrong guesses there is
  // simply nothing to render from -- the blanks cannot be faked locally.
  const hangman = useMemo(
    () => revealHangman(answerName ?? '', wrongCount, `${mode}:${date ?? 'today'}`),
    [answerName, wrongCount, mode, date],
  )

  const guess = useCallback(
    async (c: Character) => {
      if (!sessionId || finished || submitting || guessedIds.has(c.id)) return
      setSubmitting(true)
      setError(null)

      const { data, error: err } = await supabase.rpc('submit_daily_guess', {
        p_session_id: sessionId,
        p_guess_id: c.id,
      })

      if (err) {
        if (handleStaleSession(err)) return
        setError(err.message)
        setSubmitting(false)
        return
      }

      const r = data as unknown as GuessResponse
      setGuesses((prev) => [...prev, toEntry({ id: r.guessId, name: r.guessName, clue: r.clue })])
      setSolved(r.solved)
      if (r.answerName) setAnswerName(r.answerName)
      if (r.answerId) setAnswer(BY_ID.get(r.answerId) ?? null)
      setSubmitting(false)
    },
    [sessionId, finished, submitting, guessedIds, toEntry, handleStaleSession],
  )

  const giveUp = useCallback(async () => {
    if (!sessionId || finished) return
    const { data, error: err } = await supabase.rpc('give_up', { p_session_id: sessionId })
    if (err) {
      if (handleStaleSession(err)) return
      setError(err.message)
      return
    }
    const r = data as unknown as { answerId: string; answerName: string }
    setGaveUp(true)
    setAnswerName(r.answerName)
    setAnswer(BY_ID.get(r.answerId) ?? null)
  }, [sessionId, finished, handleStaleSession])

  return {
    guesses,
    guessedIds,
    solved,
    gaveUp,
    finished,
    wrongCount,
    hangman,
    answer,
    loading,
    error,
    submitting,
    guess,
    giveUp,
  }
}
