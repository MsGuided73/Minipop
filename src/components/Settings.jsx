import React, { useState } from 'react'
import { X, Key, Cpu, Save, CheckCircle, AlertCircle, Settings as SettingsIcon } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './Settings.css'

const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o', desc: 'OpenAI Omni — fast and intelligent', recommended: true },
  { id: 'o1-preview', label: 'o1 Preview', desc: 'OpenAI reasoning model' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', desc: 'Google open model — max quality (256K context)' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (MoE)', desc: 'Google open model — faster, cheaper, similar quality' },
]

export default function Settings() {
  const { 
    state, 
    dispatch, 
    saveBoardToServer, 
    fetchBoardsFromServer, 
    loadBoardFromServer, 
    setBoardInfo 
  } = useCanvas()
  
  const [apiKeyInput, setApiKeyInput] = useState(state.apiKey || '')
  const [geminiKeyInput, setGeminiKeyInput] = useState(state.geminiKey || '')
  const [localBoardName, setLocalBoardName] = useState(state.boardName || 'Untitled Board')
  const [saved, setSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  React.useEffect(() => {
    fetchBoardsFromServer()
  }, [])

  const handleSave = () => {
    dispatch({ type: 'SET_API_KEY', key: apiKeyInput.trim() })
    dispatch({ type: 'SET_GEMINI_KEY', key: geminiKeyInput.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
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

  const handleTest = async () => {
    const isGoogle = state.model.startsWith('gemini') || state.model.startsWith('gemma')
    const keyToTest = isGoogle ? geminiKeyInput.trim() : apiKeyInput.trim()

    if (!keyToTest) {
      setTestResult({ ok: false, msg: `Please enter a ${isGoogle ? 'Google AI' : 'OpenAI'} API key first.` })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      if (isGoogle) {
        // Test Google AI key using a simple model info check
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${state.model}?key=${keyToTest}`)
        if (res.ok) {
          setTestResult({ ok: true, msg: 'Google AI API key is valid ✓' })
        } else {
          const data = await res.json().catch(() => ({}))
          setTestResult({ ok: false, msg: data.error?.message || `Error ${res.status}` })
        }
      } else {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${keyToTest}` },
        })
        if (res.ok) {
          setTestResult({ ok: true, msg: 'OpenAI API key is valid ✓' })
        } else {
          const data = await res.json().catch(() => ({}))
          setTestResult({ ok: false, msg: data.error?.message || `Error ${res.status}` })
        }
      }
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

        {/* API Keys */}
        <div className="settings-section">
          {/* Wrapped in a form with autoComplete="off" so browsers don't prompt to save
              these as passwords (they're API keys) and Enter saves both keys. */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            autoComplete="off"
            style={{ display: 'flex', flexDirection: 'column', gap: 15 }}
          >
            <div>
              <label className="settings-label">
                <Key size={13} /> OpenAI API Key
              </label>
              <input
                type="password"
                className="input settings-input"
                placeholder="sk-proj-..."
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                autoComplete="off"
                name="openai-api-key"
              />
            </div>
            <div>
              <label className="settings-label">
                <Key size={13} /> Google AI API Key
              </label>
              <input
                type="password"
                className="input settings-input"
                placeholder="AIzaSy..."
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                autoComplete="off"
                name="google-ai-api-key"
              />
            </div>
            {/* Hidden submit so Enter in either field triggers handleSave */}
            <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
          </form>
          
          <div className="settings-disclaimer" style={{ marginTop: 15, padding: '10px', backgroundColor: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.3)', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#ffb84d' }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span><strong>Privacy Notice:</strong> Your API keys are stored locally in your browser and are never sent to our servers. They are only sent directly to OpenAI and Google APIs when generating content.</span>
          </div>

          <div className="settings-row" style={{ marginTop: 15 }}>
            <button className="btn btn-ghost" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing...' : 'Test APIs'}
            </button>
            <button className={`btn btn-primary ${saved ? 'btn-success' : ''}`} onClick={handleSave}>
              {saved ? <><CheckCircle size={13} /> Saved!</> : <><Save size={13} /> Save Keys</>}
            </button>
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
