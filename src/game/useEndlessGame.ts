import { useCallback, useEffect, useMemo, useState } from 'react'
import { BY_ID } from '../data/pools'
import { supabase } from '../lib/supabase'
import { compare, type ClueRow } from './compare'
import { loadRecent, pickEndless, rememberRecent } from './endlessPicker'
import { revealHangman } from './hangman'
import type { Character } from './types'
import type { EndlessPoolOptions } from '../data/pools'
import type { GuessEntry } from '../components/GuessGrid'

/**
 * Endless, backed by the server when signed in.
 *
 * It used to run entirely in the browser, which meant a win was whatever the
 * client claimed, so collection entries earned in Endless were unverifiable.
 * The answer now lives in the database and never reaches the browser until it
 * is solved, the same rule the dailies follow.
 *
 * Signed-out players still get a local game so the mode remains playable
 * without an account. Those wins simply do not count towards a collection,
 * because there is no account to credit and no way to check them.
 */
export function useEndlessGame(pool: Character[], opts: EndlessPoolOptions, signedIn: boolean) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<GuessEntry[]>([])
  const [solved, setSolved] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [answer, setAnswer] = useState<Character | null>(null)
  const [answerName, setAnswerName] = useState<string | null>(null)
  const [localAnswer, setLocalAnswer] = useState<Character | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  const reset = useCallback(() => {
    setGuesses([])
    setSolved(false)
    setGaveUp(false)
    setAnswer(null)
    setAnswerName(null)
    setSessionId(null)
  }, [])

  const deal = useCallback(async () => {
    reset()
    setRound((r) => r + 1)

    if (!signedIn) {
      // Local fallback. Nothing to protect here: without an account there is
      // no collection to credit and the player can reroll at will.
      const next = pickEndless(pool, loadRecent())
      if (next) rememberRecent(next.id)
      setLocalAnswer(next)
      return
    }

    setBusy(true)
    const { data, error: err } = await supabase.rpc('start_endless', {
      p_pools: opts,
      p_exclude: loadRecent().slice(0, 25),
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setLocalAnswer(null)
    setSessionId((data as { sessionId: string }).sessionId)
  }, [pool, opts, signedIn, reset])

  // Deal on mount, and re-deal when the pool changes underneath the game.
  const poolKey = useMemo(() => JSON.stringify(opts), [opts])
  useEffect(() => {
    void deal()
    // deal changes identity with every pool edit; poolKey is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, signedIn])

  const activeAnswer = answer ?? localAnswer
  const finished = solved || gaveUp
  const wrongCount = guesses.length - (solved ? 1 : 0)
  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.id)), [guesses])

  const hangman = useMemo(
    () =>
      revealHangman(
        answerName ?? (localAnswer && wrongCount >= 4 ? localAnswer.name : '') ?? '',
        wrongCount,
        sessionId ?? localAnswer?.id ?? 'none',
      ),
    [answerName, localAnswer, wrongCount, sessionId],
  )

  const guess = useCallback(
    async (c: Character) => {
      if (finished || busy || guessedIds.has(c.id)) return

      // Signed out: compare locally.
      if (!signedIn) {
        if (!localAnswer) return
        const clue = compare(c.attrs, localAnswer.attrs)
        setGuesses((prev) => [...prev, { id: c.id, name: c.name, image: c.image, clue }])
        if (c.id === localAnswer.id) {
          setSolved(true)
          setAnswer(localAnswer)
        }
        return
      }

      if (!sessionId) return
      setBusy(true)
      const { data, error: err } = await supabase.rpc('submit_endless_guess', {
        p_session_id: sessionId,
        p_guess_id: c.id,
      })
      setBusy(false)
      if (err) {
        setError(err.message)
        return
      }

      const r = data as {
        clue: ClueRow
        guessId: string
        guessName: string
        solved: boolean
        answerName: string | null
        answerId: string | null
      }
      setGuesses((prev) => [
        ...prev,
        {
          id: r.guessId,
          name: r.guessName,
          image: BY_ID.get(r.guessId)?.image ?? `${r.guessId}.webp`,
          clue: r.clue,
        },
      ])
      if (r.answerName) setAnswerName(r.answerName)
      if (r.solved) {
        setSolved(true)
        if (r.answerId) setAnswer(BY_ID.get(r.answerId) ?? null)
      }
    },
    [finished, busy, guessedIds, signedIn, localAnswer, sessionId],
  )

  const giveUp = useCallback(async () => {
    if (finished) return
    if (!signedIn) {
      setGaveUp(true)
      setAnswer(localAnswer)
      return
    }
    if (!sessionId) return
    const { data, error: err } = await supabase.rpc('give_up_endless', { p_session_id: sessionId })
    if (err) {
      setError(err.message)
      return
    }
    const r = data as { answerId: string; answerName: string }
    setGaveUp(true)
    setAnswerName(r.answerName)
    setAnswer(BY_ID.get(r.answerId) ?? null)
  }, [finished, signedIn, localAnswer, sessionId])

  return {
    guesses,
    guessedIds,
    solved,
    gaveUp,
    finished,
    wrongCount,
    hangman,
    answer: activeAnswer && finished ? (answer ?? localAnswer) : null,
    revealed: answer ?? (finished ? localAnswer : null),
    busy,
    error,
    round,
    deal,
    guess,
    giveUp,
    clearError: () => setError(null),
  }
}
