import React, { useEffect, useMemo, useState } from 'react'
import { X, Play, Save, Sparkles } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useCanvas } from '../context/CanvasContext'
import {
  reconcileVariables,
  buildAutofillValues,
  pickPrimarySourceLabel,
  suggestVariables,
  createPrompt,
  updatePrompt,
  suggestVariationTitle,
} from '../services/promptService'

/**
 * One modal that handles three flows:
 *  - Default: fill variables, then spawn a Lens Node (calls onSpawnLensNode)
 *  - isSaveAsVariation: edit title/body/tags, then POST a new prompt linked via parent_id
 *  - isCreateNew: author a brand-new prompt from scratch, then POST it
 */
export default function PromptFillModal({
  prompt,
  isSaveAsVariation,
  isCreateNew,
  onClose,
  onSpawnLensNode,
  onRefreshLibrary,
}) {
  const { state } = useCanvas()
  const { getNodes, getEdges } = useReactFlow()

  // Both the variation and create-new flows share the same prompt editor UI.
  const showEditor = isSaveAsVariation || isCreateNew

  // ─── Editor state (variation / create-new) ──────────────────────────────
  const [varTitle, setVarTitle] = useState(
    isSaveAsVariation ? suggestVariationTitle(prompt.title) : (prompt.title || '')
  )
  const [varBody, setVarBody] = useState(prompt.body || '')
  const [varTags, setVarTags] = useState((prompt.tags || []).join(', '))
  const [varDescription, setVarDescription] = useState(prompt.description || '')
  const [suggesting, setSuggesting] = useState(false)
  const [variableDefs, setVariableDefs] = useState(prompt.variables || [])

  // ─── Fill flow state ────────────────────────────────────────────────────
  const reconciled = useMemo(
    () => reconcileVariables(prompt.body, prompt.variables || []),
    [prompt.body, prompt.variables]
  )

  const [values, setValues] = useState(() => {
    const initial = {}
    reconciled.forEach(v => { initial[v.name] = v.default ?? '' })
    return initial
  })
  const [runImmediately, setRunImmediately] = useState(prompt.defaultRunMode === 'auto')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Resolve target source: prefer explicit selection, else fall back to the most
  // recent content node (matches App.jsx handleSpawnLensNode auto-detection).
  const selectedNode = useMemo(() => {
    const nodes = getNodes()
    const explicit = nodes.find(n => n.selected)
    if (explicit) return explicit
    const PRIORITY = ['youtubeNode', 'mediaNode', 'documentNode', 'urlNode', 'textNode']
    for (const type of PRIORITY) {
      const matches = nodes.filter(n => n.type === type)
      if (matches.length > 0) return matches[matches.length - 1]
    }
    return null
  }, [getNodes])

  // On mount: auto-fill from selected node's connection context.
  // If a source node is selected, we treat it as the "connected source" for autofill.
  useEffect(() => {
    if (showEditor) return
    if (!selectedNode) return
    // Build a synthetic edge list so buildAutofillValues sees the selected node as connected
    const synthetic = [{ id: 'synthetic', source: 'lens-placeholder', target: selectedNode.id }]
    const syntheticNodes = [...getNodes(), { id: 'lens-placeholder', type: 'lensNode', position: { x: 0, y: 0 } }]
    const auto = buildAutofillValues('lens-placeholder', syntheticNodes, synthetic, reconciled)
    setValues(prev => ({ ...prev, ...auto }))
  }, [selectedNode, reconciled, showEditor, getNodes])

  // ─── Submit handlers ─────────────────────────────────────────────────────

  async function handleSpawn() {
    setSubmitting(true)
    setError('')
    try {
      const sourceLabel = selectedNode?.data?.label || null
      const lensTitle = sourceLabel
        ? `${prompt.title} · ${sourceLabel}`
        : `${prompt.title}`

      onSpawnLensNode({
        promptId: prompt.id,
        promptTitle: prompt.title,
        promptBody: prompt.body,
        variables: reconciled,
        values,
        runImmediately,
        sourceNodeId: selectedNode?.id || null,
        label: lensTitle,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSavePrompt() {
    if (!varTitle.trim()) {
      setError('Title is required.')
      return
    }
    if (!varBody.trim()) {
      setError('Prompt body is required.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const tagsArr = varTags
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
      await createPrompt({
        title: varTitle.trim(),
        body: varBody,
        description: varDescription.trim() || null,
        tags: tagsArr,
        variables: variableDefs,
        // Variations are linked to their source prompt; new prompts stand alone.
        ...(isSaveAsVariation ? { parentId: prompt.id } : {}),
      })
      onRefreshLibrary?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSuggestVariables() {
    if (!varBody.trim()) return
    setSuggesting(true)
    setError('')
    try {
      const suggested = await suggestVariables(varBody, state.apiKey, state.model, state.geminiKey, state.anthropicKey)
      setVariableDefs(suggested)
    } catch (err) {
      setError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel animate-scale-in"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="settings-header">
          <div className="settings-title-row">
            <div className="settings-title-icon">
              {showEditor ? <Save size={16} /> : <Play size={16} />}
            </div>
            <h2 className="settings-title">
              {isCreateNew ? 'New Prompt' : isSaveAsVariation ? 'Save as Variation' : `Use: ${prompt.title}`}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 4px' }}>
          {/* ───── Prompt editor (variation / create-new) ───── */}
          {showEditor && (
            <div className="settings-section">
              <label className="settings-label">{isCreateNew ? 'Title' : 'Variation Title'}</label>
              <input
                className="input settings-input"
                value={varTitle}
                onChange={e => setVarTitle(e.target.value)}
                placeholder={isCreateNew ? 'My new prompt' : 'My customized variation'}
              />

              <label className="settings-label" style={{ marginTop: 14 }}>Description (optional)</label>
              <input
                className="input settings-input"
                value={varDescription}
                onChange={e => setVarDescription(e.target.value)}
                placeholder="Short summary shown in the library list"
              />

              <label className="settings-label" style={{ marginTop: 14 }}>Tags (comma-separated)</label>
              <input
                className="input settings-input"
                value={varTags}
                onChange={e => setVarTags(e.target.value)}
                placeholder="analysis, monetization, custom"
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 6 }}>
                <label className="settings-label" style={{ margin: 0 }}>Prompt Body</label>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={handleSuggestVariables}
                  disabled={suggesting || !varBody.trim()}
                  title="Use AI to identify {{variables}} that should be templatized"
                >
                  <Sparkles size={12} /> {suggesting ? 'Suggesting…' : 'Suggest Variables'}
                </button>
              </div>
              <textarea
                className="input settings-input"
                style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5 }}
                value={varBody}
                onChange={e => setVarBody(e.target.value)}
                placeholder="Use {{variable_name}} for templated fields"
              />
              <p className="settings-hint" style={{ marginTop: 8 }}>
                Variables currently detected: {variableDefs.length === 0 ? 'none' : variableDefs.map(v => v.name).join(', ')}
              </p>
            </div>
          )}

          {/* ───── Fill-variables flow ───── */}
          {!showEditor && (
            <>
              <div className="settings-section">
                <p className="settings-hint" style={{ marginBottom: 12 }}>
                  {selectedNode
                    ? `Will connect to: "${selectedNode.data?.label || selectedNode.id}" (${selectedNode.type})`
                    : 'No source nodes on canvas. The Lens Node will spawn unconnected — drop a YouTube/PDF/text node first, or wire it manually after.'}
                </p>

                {reconciled.length === 0 && (
                  <p className="settings-hint">
                    This prompt has no variables. Click "Spawn Lens Node" to run it as-is.
                  </p>
                )}

                {reconciled.map(v => (
                  <div key={v.name} style={{ marginBottom: 14 }}>
                    <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {v.label || v.name}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                        {`{{${v.name}}}`}
                      </span>
                    </label>
                    {v.description && (
                      <p className="settings-hint" style={{ marginTop: 2, marginBottom: 6 }}>{v.description}</p>
                    )}
                    {v.type === 'select' && Array.isArray(v.options) ? (
                      <select
                        className="input settings-input"
                        value={values[v.name] ?? ''}
                        onChange={e => setValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                      >
                        {v.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : v.type === 'textarea' ? (
                      <textarea
                        className="input settings-input"
                        style={{ minHeight: 70 }}
                        value={values[v.name] ?? ''}
                        onChange={e => setValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                      />
                    ) : (
                      <input
                        type="text"
                        className="input settings-input"
                        value={values[v.name] ?? ''}
                        onChange={e => setValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={runImmediately}
                    onChange={e => setRunImmediately(e.target.checked)}
                  />
                  Run immediately (otherwise the Lens Node opens in review mode with a Run button)
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="settings-section" style={{ color: 'var(--accent-danger)', fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="settings-row" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-default)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {showEditor ? (
            <button className="btn btn-primary" onClick={handleSavePrompt} disabled={submitting}>
              <Save size={13} /> {submitting ? 'Saving…' : isCreateNew ? 'Create Prompt' : 'Save Variation'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSpawn} disabled={submitting}>
              <Play size={13} /> {submitting ? 'Spawning…' : 'Spawn Lens Node'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
