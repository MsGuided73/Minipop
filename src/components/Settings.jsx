import React, { useState } from 'react'
import { X, Key, Cpu, Save, CheckCircle, AlertCircle, Shield, Trash2, Settings as SettingsIcon } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { getProvider } from '../services/aiService'
import { apiFetch } from '../services/apiClient'
import { MODELS } from '../constants/models'
import './Settings.css'

const PROVIDER_NAMES = { openai: 'OpenAI', google: 'Google AI', anthropic: 'Anthropic' }
const PROVIDER_PLACEHOLDERS = { openai: 'sk-proj-…', google: 'AIzaSy…', anthropic: 'sk-ant-…' }

export default function Settings() {
  const {
    state,
    dispatch,
    saveBoardToServer,
    fetchBoardsFromServer,
    loadBoardFromServer,
    setBoardInfo,
    fetchKeys,
    saveKey,
    removeKey,
  } = useCanvas()

  // One draft per provider, cleared the moment it is saved: a key exists in
  // this component for as long as it takes to send it, and no longer.
  const [drafts, setDrafts] = useState({ openai: '', google: '', anthropic: '' })
  const [busyProvider, setBusyProvider] = useState(null)
  const [keyError, setKeyError] = useState('')
  const [localBoardName, setLocalBoardName] = useState(state.boardName || 'Untitled Board')
  const [saved, setSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  React.useEffect(() => {
    fetchBoardsFromServer()
    fetchKeys()
  }, [])

  const savedKey = (provider) => state.keys.find(k => k.provider === provider)

  const handleSaveKey = async (provider) => {
    const key = drafts[provider].trim()
    if (!key) return
    setBusyProvider(provider)
    setKeyError('')
    try {
      await saveKey(provider, key)
      setDrafts(d => ({ ...d, [provider]: '' }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setKeyError(err.message)
    } finally {
      setBusyProvider(null)
    }
  }

  const handleRemoveKey = async (provider) => {
    setBusyProvider(provider)
    setKeyError('')
    try {
      await removeKey(provider)
    } catch (err) {
      setKeyError(err.message)
    } finally {
      setBusyProvider(null)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await saveBoardToServer(localBoardName)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      fetchBoardsFromServer()
    } catch (err) {
      alert(err.message)
    } finally {
      setSyncing(false)
    }
  }

  // Testing used to call the provider from this page with the key in hand.
  // The key is not here any more, so the test is a real (tiny) completion run
  // by the server with the stored key — which is a better test anyway: it
  // exercises the exact path a prompt takes.
  const handleTest = async () => {
    const provider = getProvider(state.model)
    if (!savedKey(provider)) {
      setTestResult({ ok: false, msg: `No ${PROVIDER_NAMES[provider]} key saved yet.` })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiFetch('/api/v1/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: state.model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          maxTokens: 5,
        }),
      })
      const body = await res.json().catch(() => ({}))
      setTestResult(res.ok
        ? { ok: true, msg: `${PROVIDER_NAMES[provider]} key works ✓` }
        : { ok: false, msg: [body.error, body.detail].filter(Boolean).join(' ') || `Error ${res.status}` })
    } catch {
      setTestResult({ ok: false, msg: 'Connection failed. Check your network.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={() => dispatch({ type: 'CLOSE_SETTINGS' })}>
      <div className="settings-panel animate-scale-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <div className="settings-title-row">
            <div className="settings-title-icon">
              <SettingsIcon size={16} />
            </div>
            <h2 className="settings-title">Settings</h2>
          </div>
          <button
            className="btn-icon"
            onClick={() => dispatch({ type: 'CLOSE_SETTINGS' })}
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">

        {/* API Keys — write-only. A saved key is shown as a hint and can be
            replaced or removed, never read back: it is not in this page to
            read. See lib/keyCrypto.js and supabase/user_keys.sql. */}
        <div className="settings-section">
          <label className="settings-label" style={{ marginBottom: 12 }}>
            <Key size={13} /> Your API keys
          </label>

          {['openai', 'google', 'anthropic'].map(provider => {
            const saved = savedKey(provider)
            const busy = busyProvider === provider
            return (
              <form
                key={provider}
                autoComplete="off"
                onSubmit={e => { e.preventDefault(); handleSaveKey(provider) }}
                style={{ marginBottom: 14 }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span className="settings-label" style={{ marginBottom: 0 }}>{PROVIDER_NAMES[provider]}</span>
                  {saved && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                      {saved.hint}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    className="input settings-input"
                    style={{ flex: 1 }}
                    placeholder={saved ? 'Paste a new key to replace it' : PROVIDER_PLACEHOLDERS[provider]}
                    value={drafts[provider]}
                    onChange={e => setDrafts(d => ({ ...d, [provider]: e.target.value }))}
                    autoComplete="off"
                    name={`${provider}-api-key`}
                    aria-label={`${PROVIDER_NAMES[provider]} API key`}
                    disabled={busy}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busy || !drafts[provider].trim()}
                  >
                    {busy ? '…' : saved ? 'Replace' : 'Save'}
                  </button>
                  {saved && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleRemoveKey(provider)}
                      disabled={busy}
                      title={`Remove your ${PROVIDER_NAMES[provider]} key`}
                      aria-label={`Remove your ${PROVIDER_NAMES[provider]} key`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </form>
            )
          })}

          {keyError && (
            <p style={{ color: 'var(--accent-danger)', fontSize: 12, margin: '4px 0 0' }}>{keyError}</p>
          )}

          <div className="settings-disclaimer" style={{ marginTop: 15, padding: '10px', backgroundColor: 'rgba(80,200,160,0.08)', border: '1px solid rgba(80,200,160,0.28)', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-secondary, #9ccdbd)' }}>
            <Shield size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              <strong>Your key, your account.</strong> Keys are encrypted before they are stored
              and are only ever used to make the calls you ask for. They are never sent back to
              the browser — not even to this screen — so a saved key shows as a hint and can be
              replaced, not read. They follow you to any browser you sign in from.
            </span>
          </div>

          <div className="settings-row" style={{ marginTop: 15 }}>
            <button className="btn btn-ghost" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : `Test ${PROVIDER_NAMES[getProvider(state.model)]}`}
            </button>
            {saved && <span style={{ color: 'var(--accent-success, #4ade80)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle size={13} /> Saved</span>}
          </div>
        </div>

        {/* Cloud Knowledge Hub */}
        <div className="settings-section">
          <label className="settings-label">
            <Save size={13} /> Cloud Knowledge Hub (VPS Sync)
          </label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
            <input
              type="text"
              className="input settings-input"
              style={{ flex: 1 }}
              placeholder="Board Name (e.g., Company Branding)"
              value={localBoardName}
              onChange={e => {
                setLocalBoardName(e.target.value)
                setBoardInfo(e.target.value)
              }}
            />
          </div>
          <button 
            className={`btn btn-primary ${syncing ? 'loading' : ''}`}
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : <><Save size={14} /> Sync Board to VPS</>}
          </button>

          {state.remoteBoards?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p className="settings-hint" style={{ marginBottom: 10, opacity: 0.8 }}>Existing Knowledge Bases:</p>
              <div className="remote-boards-list">
                {state.remoteBoards.map(b => (
                  <button 
                    key={b.id} 
                    className={`remote-board-item ${state.boardId === b.id ? 'active' : ''}`}
                    onClick={() => loadBoardFromServer(b.id)}
                  >
                    <div className="remote-board-info">
                      <span className="remote-board-name">{b.name}</span>
                      <span className="remote-board-meta">ID: {b.id.slice(0, 8)}... • {new Date(b.createdAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Model Selection */}
        <div className="settings-section">
          <label className="settings-label">
            <Cpu size={13} />
            AI Model
          </label>
          <div className="settings-models">
            {MODELS.map(m => (
              <button
                key={m.id}
                className={`settings-model-btn ${state.model === m.id ? 'active' : ''}`}
                onClick={() => dispatch({ type: 'SET_MODEL', model: m.id })}
              >
                <div className="settings-model-info">
                  <span className="settings-model-name">{m.label}</span>
                  <span className="settings-model-desc">{m.desc}</span>
                </div>
                {m.recommended && <span className="settings-model-badge">Recommended</span>}
                {state.model === m.id && <CheckCircle size={14} className="settings-model-check" />}
              </button>
            ))}
          </div>
        </div>

        {/* Storage info */}
        <div className="settings-section settings-section--last">
          <div className="settings-info-row">
            <span className="settings-info-label">Canvas auto-saved</span>
            <span className="settings-info-val">Every 2s to localStorage</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">Nodes</span>
            <span className="settings-info-val">{state.nodes.length}</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">Connections</span>
            <span className="settings-info-val">{state.edges.length}</span>
          </div>
        </div>

        </div> {/* /settings-body */}
      </div>
    </div>
  )
}
