import React, { useEffect, useState } from 'react'
import { LogIn, UserPlus, AlertCircle } from 'lucide-react'
import { supabase, isAuthConfigured } from '../services/supabaseClient'

/**
 * Wraps the whole app. Renders children only when there is a live Supabase
 * session; otherwise shows the sign-in screen.
 *
 * This gate is convenience, not security — it stops the UI from rendering, but
 * the real enforcement is server-side (every /api/v1 route verifies the token)
 * and in the database (row-level security scopes rows to auth.uid()). Bypassing
 * this component in devtools gets you an empty canvas and a wall of 401s.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!supabase) { setChecking(false); return }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session ?? null)
      setChecking(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  if (!isAuthConfigured) return <ConfigError />
  if (checking) return <Splash message="Checking your session…" />
  if (!session) return <SignIn />

  return (
    <>
      {children}
      <SignedInBadge email={session.user?.email} />
    </>
  )
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function Splash({ message }) {
  return (
    <div style={shell}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{message}</p>
    </div>
  )
}

function ConfigError() {
  return (
    <div style={shell}>
      <div style={{ ...card, borderColor: 'var(--accent-danger)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <AlertCircle size={16} color="var(--accent-danger)" />
          <h1 style={title}>Sign-in is not configured</h1>
        </div>
        <p style={hint}>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your
          <code> .env</code>, then restart the dev server. Both values are in your Supabase
          project under Settings → API.
        </p>
      </div>
    </div>
  )
}

function SignIn() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isSignUp = mode === 'signup'

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        // With email confirmation on, there is no session yet — say so rather
        // than leaving the user staring at an unchanged form.
        if (!data.session) setNotice('Check your email to confirm the account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <form style={card} onSubmit={handleSubmit}>
        <h1 style={title}>ContentLoom</h1>
        <p style={hint}>
          {isSignUp ? 'Create an account to get your own boards and prompts.' : 'Sign in to your boards.'}
        </p>

        <label className="settings-label" style={{ marginTop: 18 }}>Email</label>
        <input
          className="input settings-input"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
          autoFocus
        />

        <label className="settings-label" style={{ marginTop: 12 }}>Password</label>
        <input
          className="input settings-input"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          minLength={8}
          required
        />
        {isSignUp && <p style={{ ...hint, marginTop: 6 }}>At least 8 characters.</p>}

        {error && <p style={{ ...hint, color: 'var(--accent-danger)', marginTop: 12 }}>{error}</p>}
        {notice && <p style={{ ...hint, color: 'var(--accent-success)', marginTop: 12 }}>{notice}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 18, justifyContent: 'center' }}>
          {isSignUp ? <UserPlus size={14} /> : <LogIn size={14} />}
          {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
          onClick={() => { setMode(isSignUp ? 'signin' : 'signup'); setError(''); setNotice('') }}
        >
          {isSignUp ? 'I already have an account' : 'Create an account'}
        </button>
      </form>
    </div>
  )
}

function SignedInBadge({ email }) {
  return (
    <div style={{
      position: 'fixed', bottom: 10, left: 10, zIndex: 40,
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      borderRadius: 8, padding: '5px 9px', fontSize: 11, color: 'var(--text-muted)',
    }}>
      <span>{email}</span>
      <button
        className="btn btn-ghost"
        style={{ fontSize: 11, padding: '2px 8px' }}
        onClick={() => supabase.auth.signOut()}
      >
        Sign out
      </button>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const shell = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-base)', padding: 20,
}
const card = {
  width: '100%', maxWidth: 380, background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 12, padding: 26,
}
const title = { fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }
const hint = { fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }
