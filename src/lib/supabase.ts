import { createClient } from '@supabase/supabase-js'

// Trimmed because a trailing space or newline in .env is both easy to do and
// invisible, and produces a confusing auth failure rather than a clear one.
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * Whether the backend is configured at all. Endless mode works without it, so
 * a missing key degrades the app rather than breaking it -- the dailies and
 * PvP explain themselves instead of throwing.
 */
export const isConfigured = Boolean(url && key)

if (import.meta.env.DEV && !isConfigured) {
  console.warn('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.')
}

/**
 * Guard against the secret key ending up here. Anything in a VITE_ variable is
 * compiled into the client bundle and served to every visitor, so a secret key
 * would be public the moment this deploys. The publishable/anon key is the only
 * correct value; the policies in 03_policies.sql are what protect the data.
 */
if (key && /^sb_secret_/.test(key)) {
  throw new Error(
    'VITE_SUPABASE_ANON_KEY holds a SECRET key (sb_secret_...). This would be published ' +
      'to every visitor in the client bundle and bypasses all row level security. ' +
      'Revoke it in the Supabase dashboard and use the publishable key (sb_publishable_...) instead.',
  )
}

/**
 * Placeholders, not `??` fallbacks: an empty string in .env is falsy but NOT
 * nullish, so it slips past `??` and createClient throws "supabaseKey is
 * required" at module scope -- which white-screens the whole app, Endless
 * included, even though Endless needs no backend. Guard every unconfigured
 * path with `isConfigured` rather than relying on this client to fail politely.
 */
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)

/**
 * Supabase Auth is email-based, but this game signs in with a username. Each
 * username maps to a stable synthesised address. Nothing is ever sent to it --
 * "Confirm email" must be off in the dashboard or no account can ever log in.
 */
export const USERNAME_DOMAIN = 'botc-wordle.local'

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`
}

export function validateUsername(username: string): string | null {
  const u = username.trim()
  if (u.length < 3) return 'At least 3 characters'
  if (u.length > 20) return 'At most 20 characters'
  if (!USERNAME_PATTERN.test(u)) return 'Letters, numbers, hyphen and underscore only'
  return null
}
