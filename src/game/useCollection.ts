import { useCallback, useEffect, useState } from 'react'
import { ALL_CHARACTERS } from '../data/pools'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../store/auth'
import type { Character } from './types'

export interface CollectionEntry {
  character_id: string
  first_earned_at: string
  earned_count: number
  /** Earned in a daily: the highest tier, and the only one that gets a mark. */
  earned_daily: boolean
  earned_endless: boolean
  earned_pvp: boolean
}

/**
 * Which characters the player has correctly named, and how.
 *
 * Every mode is now checked server side, Endless included, so an entry here is
 * a real record rather than something the browser claimed. Entries carry the
 * mode that earned them: a daily win is the top tier and is marked as such,
 * while Endless and Versus wins still unlock the character as an avatar.
 */
export function useCollection() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !isConfigured) {
      setEntries([])
      return
    }
    const { data, error: err } = await supabase.rpc('my_collection')
    if (err) {
      setError(err.message)
      setEntries([])
      return
    }
    setEntries((data as CollectionEntry[]) ?? [])
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const owned = new Set((entries ?? []).map((e) => e.character_id))
  const byId = new Map((entries ?? []).map((e) => [e.character_id, e]))
  const ownedCharacters: Character[] = ALL_CHARACTERS.filter((c) => owned.has(c.id))

  return { entries, owned, byId, ownedCharacters, error, refresh, loading: entries === null }
}
