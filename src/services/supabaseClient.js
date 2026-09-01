// Browser-side Supabase client — used only for authentication (sign in, sign up,
// session refresh). All data access still goes through the Express API, which
// verifies the session token and talks to the database with row-level security
// applied for that user.
//
// The anon key is safe to ship in the bundle *because* RLS is enabled on every
// table: without a valid user session it grants nothing. If RLS is ever turned
// off, this key becomes a full read/write credential — do not do that.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isAuthConfigured = Boolean(url && anonKey)

if (!isAuthConfigured) {
  console.error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
    'Add them to .env and restart the dev server — sign-in cannot work without them.'
  )
}

export const supabase = isAuthConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'contentloom_auth',
      },
    })
  : null

export async function getAccessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || null
}
