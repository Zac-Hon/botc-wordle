import { useCallback, useEffect, useState } from 'react'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'

export interface Achievement {
  id: string
  name: string
  description: string
  category: 'dailies' | 'collection' | 'versus'
  goal: number
  grants_title: string | null
  grants_frame: string | null
  sort: number
  /** Already clamped to the goal server side. */
  progress: number
  earned_at: string | null
}

export const CATEGORY_LABELS: Record<Achievement['category'], string> = {
  dailies: 'Dailies',
  collection: 'Collection',
  versus: 'Versus',
}

/**
 * The full checklist, locked entries included.
 *
 * my_achievements returns the whole catalogue left-joined to the player's rows,
 * so an entry nobody has started still arrives with a goal and a progress of
 * zero. That is deliberate: the page is meant to show what is left, the same
 * way the collection silhouettes characters you have not named.
 */
export function useAchievements() {
  const { user } = useAuth()
  const [items, setItems] = useState<Achievement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !isConfigured) {
      setItems([])
      return
    }
    const { data, error: err } = await supabase.rpc('my_achievements')
    if (err) {
      setError(err.message)
      setItems([])
      return
    }
    setItems((data as Achievement[]) ?? [])
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const earned = (items ?? []).filter((a) => a.earned_at !== null)

  return {
    items,
    earned,
    /** Titles this player may wear, in catalogue order. */
    titles: earned.map((a) => a.grants_title).filter((t): t is string => Boolean(t)),
    /** Frame ids this player may wear. */
    frames: earned.map((a) => a.grants_frame).filter((f): f is string => Boolean(f)),
    error,
    refresh,
    loading: items === null,
  }
}
