import React, { useState } from 'react'
import { X, Key, Cpu, Save, CheckCircle, AlertCircle } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './Settings.css'

const MODELS = [
  { id: 'gpt-5.2-2025-12-11', label: 'GPT-5.2', desc: 'Newest — most advanced (Dec 2025)', recommended: true },
  { id: 'gpt-4.1-2025-04-14', label: 'GPT-4.1', desc: 'High capability GPT-4 series (Apr 2025)' },
  { id: 'o4-mini-2025-04-16', label: 'o4-mini', desc: 'Fast reasoning model (Apr 2025)' },
]

export default function Settings() {
  const { state, dispatch } = useCanvas()
  const [apiKeyInput, setApiKeyInput] = useState(state.apiKey || '')
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleSave = () => {
    dispatch({ type: 'SET_API_KEY', key: apiKeyInput.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleTest = async () => {
    if (!apiKeyInput.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKeyInput.trim()}` },
      })
      if (res.ok) {
        setTestResult({ ok: true, msg: 'API key is valid ✓' })
      } else {
        const data = await res.json().catch(() => ({}))
        setTestResult({ ok: false, msg: data.error?.message || `Error ${res.status}` })
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
              <Key size={16} />
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

        {/* API Key */}
        <div className="settings-section">
          <label className="settings-label">
            <Key size={13} />
            OpenAI API Key
          </label>
          <div className="settings-api-row">
            <input
              type="password"
              className="input settings-input"
              placeholder="sk-proj-..."
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              id="settings-api-key"
            />
          </div>
          <p className="settings-hint">
            Your API key is stored locally in your browser and never sent to any server except OpenAI.
          </p>
          <div className="settings-row">
            <button
              className="btn btn-ghost"
              onClick={handleTest}
              disabled={!apiKeyInput.trim() || testing}
            >
              {testing ? 'Testing...' : 'Test Key'}
            </button>
            <button
              className={`btn btn-primary ${saved ? 'btn-success' : ''}`}
              onClick={handleSave}
            >
              {saved ? <><CheckCircle size={13} /> Saved!</> : <><Save size={13} /> Save Key</>}
            </button>
          </div>

          {testResult && (
            <div className={`settings-test-result ${testResult.ok ? 'ok' : 'err'}`}>
              {testResult.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
              {testResult.msg}
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
      </div>
    </div>
  )
}
