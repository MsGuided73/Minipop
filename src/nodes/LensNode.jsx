import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Handle, Position, useReactFlow, useEdges, useNodes } from '@xyflow/react'
import { X, Eye, Play, Copy, Check, Trash2, Loader, AlertCircle, FileText, Edit3, RefreshCw, Send, Bot, User as UserIcon, Code2, Download } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { callLensChat, LENS_KICKOFF, resolveConnectedNodeIds } from '../services/aiService'
import { renderPrompt } from '../services/promptService'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function LensNode({ id, data, selected }) {
  const { deleteNode, updateNode, state } = useCanvas()
  const { getNodes, getEdges } = useReactFlow()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label || 'Lens')
  const [input, setInput] = useState('')
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)

  const messages = data.messages || []
  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 11 })
  const renderedPrompt = useMemo(
    () => data.renderedPrompt || (data.promptBody ? renderPrompt(data.promptBody, data.values || {}) : ''),
    [data.renderedPrompt, data.promptBody, data.values]
  )

  const allEdges = useEdges()
  const allNodes = useNodes()
  const connectedSources = useMemo(() => {
    const ids = resolveConnectedNodeIds(id, allNodes, allEdges)
    return allNodes.filter(n => ids.includes(n.id) && n.type !== 'lensNode' && n.type !== 'aiAssistantNode')
  }, [allNodes, allEdges, id])

  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const sendTurn = useCallback(async (userMessage, currentMessages) => {
    setLoading(true)
    setError('')
    try {
      const reply = await callLensChat(
        id,
        userMessage,
        renderedPrompt,
        currentMessages,
        getNodes(),
        getEdges(),
        state.apiKey,
        state.model,
        state.geminiKey
      )
      const nextMessages = [
        ...currentMessages,
        { role: 'user', content: userMessage, hidden: userMessage === LENS_KICKOFF },
        { role: 'assistant', content: reply },
      ]
      updateNode(id, { data: { messages: nextMessages, renderedPrompt } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id, renderedPrompt, getNodes, getEdges, state.apiKey, state.model, state.geminiKey, updateNode])

  const handleInitialRun = useCallback(() => {
    if (!renderedPrompt) {
      setError('No prompt to run.')
      return
    }
    sendTurn(LENS_KICKOFF, [])
  }, [renderedPrompt, sendTurn])

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    sendTurn(msg, messages)
  }, [input, loading, messages, sendTurn])

  const handleRerunInitial = useCallback(() => {
    if (loading) return
    if (!window.confirm('Re-run the original prompt? This will replace the current conversation.')) return
    updateNode(id, { data: { messages: [] } })
    setTimeout(() => sendTurn(LENS_KICKOFF, []), 0)
  }, [id, updateNode, loading, sendTurn])

  const handleClear = useCallback((e) => {
    e.stopPropagation()
    if (!window.confirm('Clear the entire conversation? This cannot be undone.')) return
    updateNode(id, { data: { messages: [] } })
  }, [id, updateNode])

  const handleCopyMessage = useCallback((content, idx) => {
    navigator.clipboard.writeText(content)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }, [])

  // Build a markdown transcript: header → system prompt → every visible exchange
  const buildTranscript = useCallback(() => {
    const title = data.label || 'Lens'
    const promptTitle = data.promptTitle || 'Custom prompt'
    const sources = connectedSources.map(n => n.data?.label || n.type).join(', ') || 'None'
    const timestamp = new Date().toISOString()

    const lines = [
      `# ${title}`,
      '',
      `- **Prompt template:** ${promptTitle}`,
      `- **Source(s):** ${sources}`,
      `- **Exported:** ${timestamp}`,
      '',
      '---',
      '',
      '## System Prompt (rendered)',
      '',
      renderedPrompt || '_(none)_',
      '',
      '---',
      '',
      '## Conversation',
      '',
    ]

    let firstAssistantRendered = false
    messages.forEach(m => {
      if (m.hidden) return
      if (m.role === 'assistant' && !firstAssistantRendered) {
        lines.push('### Initial Analysis', '')
        firstAssistantRendered = true
      } else if (m.role === 'user') {
        lines.push('### You', '')
      } else {
        lines.push('### Assistant', '')
      }
      lines.push(m.content, '', '---', '')
    })

    return lines.join('\n')
  }, [data.label, data.promptTitle, connectedSources, renderedPrompt, messages])

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(buildTranscript())
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }, [buildTranscript])

  const handleDownloadAll = useCallback(() => {
    const transcript = buildTranscript()
    const slug = (data.label || 'lens')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80) || 'lens'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const blob = new Blob([transcript], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-${stamp}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [buildTranscript, data.label])

  const handlePromptChange = useCallback((e) => {
    updateNode(id, { data: { renderedPrompt: e.target.value } })
  }, [id, updateNode])

  const commitLabel = useCallback(() => {
    setEditingLabel(false)
    const next = labelDraft.trim() || 'Lens'
    if (next !== data.label) updateNode(id, { data: { label: next } })
  }, [labelDraft, data.label, id, updateNode])

  // Auto-run on mount if spawn marked "Run immediately"
  const autoFiredRef = useRef(false)
  useEffect(() => {
    if (data.runOnMount && !autoFiredRef.current && messages.length === 0 && !loading) {
      autoFiredRef.current = true
      updateNode(id, { data: { runOnMount: false } })
      handleInitialRun()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.runOnMount])

  // ── Render ───────────────────────────────────────────────────────────────

  const visibleMessages = messages.filter(m => !m.hidden)
  const hasStarted = messages.length > 0
  const sourceLine = connectedSources.length > 0
    ? `${connectedSources.length} source${connectedSources.length !== 1 ? 's' : ''} · ${data.promptTitle || 'custom prompt'}`
    : `No source connected · ${data.promptTitle || 'custom prompt'}`

  return (
    <div className={`node analysis-node ${selected ? 'node--selected' : ''}`} style={{ width: 420, height: 580 }}>
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      {/* Header */}
      <div className="node-header analysis-node-header">
        <div className="node-header-left" style={{ flex: 1, minWidth: 0 }}>
          <div className="node-icon node-icon--analysis">
            <Eye size={13} />
          </div>
          <div className="ai-header-info" style={{ flex: 1, minWidth: 0 }}>
            {editingLabel ? (
              <input
                autoFocus
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={e => { if (e.key === 'Enter') commitLabel() }}
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  padding: '2px 6px',
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                }}
              />
            ) : (
              <span
                className="node-label truncate"
                onDoubleClick={() => { setLabelDraft(data.label || 'Lens'); setEditingLabel(true) }}
                title="Double-click to rename"
                style={{ cursor: 'text' }}
              >
                {data.label || 'Lens'}
              </span>
            )}
            <span className="ai-node-subtitle">{sourceLine}</span>
          </div>
        </div>
        <div className="node-actions">
          {hasStarted && (
            <button
              className="node-action-btn"
              onClick={handleCopyAll}
              title="Copy entire conversation (with prompt) to clipboard"
            >
              {copiedAll ? <Check size={11} /> : <Copy size={11} />}
            </button>
          )}
          {hasStarted && (
            <button
              className="node-action-btn"
              onClick={handleDownloadAll}
              title="Download transcript as Markdown (.md)"
            >
              <Download size={11} />
            </button>
          )}
          {hasStarted && (
            <button
              className="node-action-btn"
              onClick={() => setShowSystemPrompt(prev => !prev)}
              title={showSystemPrompt ? 'Hide system prompt' : 'View system prompt'}
            >
              <Code2 size={11} />
            </button>
          )}
          {hasStarted && (
            <button className="node-action-btn" onClick={handleClear} title="Clear conversation">
              <Trash2 size={11} />
            </button>
          )}
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="analysis-content node-scrollable nopan" onClick={e => e.stopPropagation()}>
        {/* ── Review mode: before first run ── */}
        {!hasStarted && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Rendered Prompt
              </span>
              <button
                className="node-action-btn"
                onClick={() => setEditingPrompt(p => !p)}
                title={editingPrompt ? 'Stop editing' : 'Edit before running'}
              >
                <Edit3 size={11} />
              </button>
            </div>

            {editingPrompt ? (
              <textarea
                value={renderedPrompt}
                onChange={handlePromptChange}
                style={{
                  flex: 1,
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: 10,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  lineHeight: 1.5,
                  resize: 'none',
                }}
              />
            ) : (
              <div
                style={{
                  flex: 1,
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: 10,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  lineHeight: 1.5,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {renderedPrompt || '(No prompt body. Use the Prompt Library to populate this node.)'}
              </div>
            )}

            {error && (
              <div className="ai-error">
                <AlertCircle size={12} /> {error}
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleInitialRun}
              disabled={!renderedPrompt || connectedSources.length === 0 || loading}
              style={{ justifyContent: 'center' }}
            >
              {loading ? <><Loader size={13} className="spin" /> Running…</> : <><Play size={13} /> Run Lens</>}
            </button>
            {connectedSources.length === 0 && (
              <p className="settings-hint" style={{ textAlign: 'center', marginTop: 0 }}>
                Connect a source node first.
              </p>
            )}
          </div>
        )}

        {/* ── Chat mode: after first run ── */}
        {hasStarted && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <NodeReaderBar
              reader={reader}
              placeholder="Find in conversation…"
              matchCount={reader.countMatches(visibleMessages.map(m => m.content))}
              compact
            />
            {showSystemPrompt && (
              <div style={{
                padding: 10,
                background: 'var(--bg-card)',
                borderBottom: '1px solid var(--border-default)',
                fontFamily: 'monospace',
                fontSize: 10,
                lineHeight: 1.4,
                color: 'var(--text-secondary)',
                maxHeight: 160,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
              }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>SYSTEM PROMPT</div>
                {renderedPrompt}
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              {visibleMessages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 10,
                    flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: m.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                    color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {m.role === 'user' ? <UserIcon size={11} /> : <Bot size={11} />}
                  </div>
                  <div style={{
                    background: m.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-card)',
                    color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                    border: m.role === 'user' ? 'none' : '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 10px',
                    fontSize: reader.fontSize,
                    lineHeight: 1.5,
                    maxWidth: '85%',
                    whiteSpace: 'pre-wrap',
                    position: 'relative',
                  }}>
                    {reader.highlight(m.content)}
                    {m.role === 'assistant' && (
                      <button
                        onClick={() => handleCopyMessage(m.content, i)}
                        style={{
                          position: 'absolute', top: 4, right: 4,
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', padding: 2, borderRadius: 4,
                        }}
                        title="Copy"
                      >
                        {copiedIdx === i ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'var(--bg-elevated)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Bot size={11} />
                  </div>
                  <div className="ai-typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}

              {error && (
                <div className="ai-error">
                  <AlertCircle size={12} /> {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input + actions */}
            <div style={{
              borderTop: '1px solid var(--border-default)',
              padding: 8,
              background: 'var(--bg-deep)',
            }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Ask a follow-up about this analysis…"
                  rows={2}
                  style={{
                    flex: 1,
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '6px 8px',
                    fontSize: 11,
                    fontFamily: 'var(--font-sans)',
                    resize: 'none',
                    outline: 'none',
                  }}
                  disabled={loading}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  style={{ padding: '6px 10px', height: 'fit-content' }}
                  title="Send (Enter)"
                >
                  <Send size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                <span>↵ Send · ⇧↵ Newline</span>
                <button
                  onClick={handleRerunInitial}
                  disabled={loading}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                  }}
                  title="Re-run the original prompt (replaces conversation)"
                >
                  <RefreshCw size={10} /> Re-run original
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
