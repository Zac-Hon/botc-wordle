import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, usernameToEmail, validateUsername } from '../lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  /** Display name from profiles, which preserves the casing the player chose. */
  username: string | null
  /** True until the initial session lookup settles, so routes can wait. */
  loading: boolean
  error: string | null

  init: () => () => void
  loadProfile: () => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
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
      set({ username: null })
      return
    }
    const { data } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
    set({ username: data?.username ?? null })
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
    set({ session: null, user: null, username: null })
  },

  clearError: () => set({ error: null }),
}))
