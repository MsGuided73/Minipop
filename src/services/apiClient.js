// Single entry point for every call to the ContentLoom API.
//
// Attaches the current Supabase access token so the server can identify the user
// and scope the query. Every /api/v1 route now rejects unauthenticated requests,
// so a bare fetch() to the API will 401 — always go through apiFetch.
import { getAccessToken, supabase } from './supabaseClient'

export class AuthExpiredError extends Error {
  constructor(message = 'Your session expired. Sign in again.') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

export async function apiFetch(path, options = {}) {
  const token = await getAccessToken()

  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...options, headers })

  // A 401 here means the token is missing, expired, or was revoked. Clear the
  // stale session so the app falls back to the sign-in screen rather than
  // looping on failed requests with a dead token.
  if (res.status === 401) {
    await supabase?.auth.signOut().catch(() => {})
    throw new AuthExpiredError()
  }

  return res
}
