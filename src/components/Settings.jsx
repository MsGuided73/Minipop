import React, { useState } from 'react'
import { X, Key, Cpu, Save, CheckCircle, AlertCircle, Settings as SettingsIcon } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './Settings.css'

const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o', desc: 'Fast and intelligent (Omni)', recommended: true },
  { id: 'o1-preview', label: 'o1 Preview', desc: 'Advanced reasoning and problem solving' },
  { id: 'gemini-2.5-pro', label: 'Gemini 3.1 Pro', desc: 'Google High Capability (Environment: 2.5 Pro)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Google Ultra-fast' },
]

export default function Settings() {
  const { state, dispatch } = useCanvas()
  const [apiKeyInput, setApiKeyInput] = useState(state.apiKey || '')
  const [geminiKeyInput, setGeminiKeyInput] = useState(state.geminiKey || '')
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleSave = () => {
    dispatch({ type: 'SET_API_KEY', key: apiKeyInput.trim() })
    dispatch({ type: 'SET_GEMINI_KEY', key: geminiKeyInput.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleTest = async () => {
    const isGemini = state.model.startsWith('gemini')
    const keyToTest = isGemini ? geminiKeyInput.trim() : apiKeyInput.trim()
    
    if (!keyToTest) {
      setTestResult({ ok: false, msg: `Please enter a ${isGemini ? 'Gemini' : 'OpenAI'} API key first.` })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      if (isGemini) {
        // Test Gemini key using a simple model info check or content generation
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${state.model}?key=${keyToTest}`)
        if (res.ok) {
          setTestResult({ ok: true, msg: 'Gemini API key is valid ✓' })
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

        {/* API Keys */}
        <div className="settings-section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label className="settings-label">
                <Key size={13} />
                OpenAI API Key
              </label>
              <input
                type="password"
                className="input settings-input"
                placeholder="sk-proj-..."
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
              />
            </div>
            <div>
              <label className="settings-label">
                <Key size={13} />
                Google Gemini API Key
              </label>
              <input
                type="password"
                className="input settings-input"
                placeholder="AIzaSy..."
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
              />
            </div>
          </div>
          
          <p className="settings-hint">
            API keys are stored locally in your browser (Base64 obfuscated) and only sent directly to model providers.
          </p>
          
          <div className="settings-row">
            <button
              className="btn btn-ghost"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test Selected Model'}
            </button>
            <button
              className={`btn btn-primary ${saved ? 'btn-success' : ''}`}
              onClick={handleSave}
            >
              {saved ? <><CheckCircle size={13} /> Saved!</> : <><Save size={13} /> Save Keys</>}
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
