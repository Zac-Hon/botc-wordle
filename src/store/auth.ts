import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { isStaleSession, supabase, usernameToEmail, validateUsername } from '../lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  /** Display name from profiles, which preserves the casing the player chose. */
  username: string | null
  pronouns: string | null
  /** Character id of the earned token worn as a profile picture. */
  avatar: string | null
  /** Earned title worn next to the name, or null. */
  title: string | null
  /** Earned avatar frame id, or null. See src/game/frames.ts. */
  frame: string | null
  /** True until the initial session lookup settles, so routes can wait. */
  loading: boolean
  error: string | null

  init: () => () => void
  loadProfile: () => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** Clears a session whose account no longer exists. */
  handleStaleSession: (error: { message?: string; code?: string } | null) => boolean
  clearError: () => void
}

/** Turns Supabase's auth errors into something a player can act on. */
function readableError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong username or password'
  if (m.includes('already registered') || m.includes('already exists')) return 'That username is taken'
  if (m.includes('email not confirmed')) {
    return 'This account is unconfirmed. Turn off “Confirm email” in Supabase, then sign up again.'
  }
  if (m.includes('password')) return 'Password must be at least 6 characters'
  if (m.includes('email') && (m.includes('invalid') || m.includes('valid'))) {
    return 'Supabase rejected the address generated for this username. Try a simpler one.'
  }
  return message
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  username: null,
  pronouns: null,
  avatar: null,
  title: null,
  frame: null,
  loading: true,
  error: null,

  init: () => {
    void supabase.auth.getSession().then(async ({ data }) => {
      set({ session: data.session, user: data.session?.user ?? null, loading: false })
      await get().loadProfile()
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, loading: false })
      void get().loadProfile()
    })

    return () => sub.subscription.unsubscribe()
  },

  loadProfile: async () => {
    const user = get().user
    if (!user) {
      set({ username: null, pronouns: null, avatar: null, title: null, frame: null })
      return
    }

    // The whole identity in one round trip, so the top bar can show the token
    // the player earned rather than a generic icon.
    const { data, error } = await supabase
      .from('profiles')
      .select('username, pronouns, avatar_character_id, title, frame')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      // title and frame arrive with migration 17. Until it is applied the wide
      // select fails outright, and losing the username with it would sign the
      // player out of every screen that greets them by name.
      const { data: basic } = await supabase
        .from('profiles')
        .select('username, pronouns, avatar_character_id')
        .eq('id', user.id)
        .maybeSingle()
      set({
        username: basic?.username ?? null,
        pronouns: basic?.pronouns ?? null,
        avatar: basic?.avatar_character_id ?? null,
        title: null,
        frame: null,
      })
      return
    }

    set({
      username: data?.username ?? null,
      pronouns: data?.pronouns ?? null,
      avatar: data?.avatar_character_id ?? null,
      title: data?.title ?? null,
      frame: data?.frame ?? null,
    })
  },

  signUp: async (username, password) => {
    const invalid = validateUsername(username)
    if (invalid) {
      set({ error: invalid })
      return
    }
    set({ error: null })

    const { error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
      // Read by the handle_new_user trigger to populate profiles.username.
      options: { data: { username: username.trim() } },
    })

    if (error) set({ error: readableError(error.message) })
  },

  signIn: async (username, password) => {
    set({ error: null })
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    })
    if (error) set({ error: readableError(error.message) })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({
      session: null,
      user: null,
      username: null,
      pronouns: null,
      avatar: null,
      title: null,
      frame: null,
    })
  },

  handleStaleSession: (error) => {
    if (!isStaleSession(error)) return false
    void supabase.auth.signOut()
    set({
      session: null,
      user: null,
      username: null,
      pronouns: null,
      avatar: null,
      title: null,
      frame: null,
      error: 'That account no longer exists. Please sign in again.',
    })
    return true
  },

  clearError: () => set({ error: null }),
}))
