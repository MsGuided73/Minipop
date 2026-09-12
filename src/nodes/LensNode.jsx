import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, useReactFlow, useEdges, useNodes } from '@xyflow/react'
import {
  MoreHorizontal, Loader, AlertCircle, Copy, Download, RefreshCw,
  Trash2, Code2, Pencil, Check,
} from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { callLensChat, LENS_KICKOFF, resolveConnectedNodeIds } from '../services/aiService'
import { renderPrompt } from '../services/promptService'
import { identityFor } from '../lib/nodeIdentity'
import { docTitle, previewText, metaLine, threadToMarkdown } from '../lib/docSummary'
import DocumentReader from '../components/reader/DocumentReader'
import './LensCard.css'

// The card is a fixed width by design: legibility of the graph beats the
// legibility of any one document, which is what the reader is for.
const CARD_WIDTH = 270
const READER_EXIT_MS = 260  // must outlast --t-panel, or the drawer unmounts mid-slide

/**
 * A Lens node: a prompt pointed at one or more sources, and the document that
 * comes back. The card stays compact; Read opens the document in the reader.
 *
 * The thread lives on the node (data.messages) and stays the source of truth.
 * The reader is a view over it — including its follow-up composer, which posts
 * back into this same thread.
 */
export default function LensNode({ id, data, selected }) {
  const { deleteNode, updateNode, state } = useCanvas()
  const { getNodes, getEdges, getNode, setNodes } = useReactFlow()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(data.label || 'Lens')
  const [copied, setCopied] = useState(false)

  // The reader mounts only once opened, and stays mounted for the exit
  // transition — mounting it already-open would skip the slide-in.
  const [readerMounted, setReaderMounted] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const exitTimer = useRef(null)
  const menuRef = useRef(null)
  const menuBtnRef = useRef(null)

  const messages = useMemo(() => data.messages || [], [data.messages])
  const hasStarted = messages.length > 0

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

  const identity = useMemo(
    () => identityFor({ promptTitle: data.promptTitle, promptTags: data.promptTags, nodeType: 'lensNode' }),
    [data.promptTitle, data.promptTags]
  )

  const documentMarkdown = useMemo(() => threadToMarkdown(messages), [messages])

  // ── Card sizing ──────────────────────────────────────────────────────────
  // Nodes spawned before the redesign carry style {width: 380, height: 460}.
  // Left alone, the wrapper keeps that box and the card floats inside a large
  // invisible hit area, so normalise it the first time such a node renders.
  useEffect(() => {
    const node = getNode(id)
    const style = node?.style || {}
    if (style.width === CARD_WIDTH && style.height == null) return
    const { height, ...rest } = style
    setNodes(nds => nds.map(n => (n.id === id ? { ...n, style: { ...rest, width: CARD_WIDTH } } : n)))
    // Deliberately mount-only. getNode/setNodes are stable React Flow handles,
    // and the guard above makes a repeat run a no-op, so re-running on every
    // node change would only cost a full-array map for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => () => clearTimeout(exitTimer.current), [])

  // ── Actions ──────────────────────────────────────────────────────────────

  // Returns whether the turn landed, so the reader knows whether to keep the
  // question the user typed. The ref guards against two turns overlapping:
  // each builds its next message list from a snapshot, so the later write
  // would silently drop the earlier one's exchange.
  const inFlight = useRef(false)

  const sendTurn = useCallback(async (userMessage, currentMessages) => {
    if (inFlight.current) return false
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const reply = await callLensChat(
        id, userMessage, renderedPrompt, currentMessages,
        getNodes(), getEdges(),
        state.model,
        { autoContinue: state.autoContinue }
      )
      const nextMessages = [
        ...currentMessages,
        { role: 'user', content: userMessage, hidden: userMessage === LENS_KICKOFF },
        { role: 'assistant', content: reply },
      ]
      const update = { messages: nextMessages, renderedPrompt }

      // A finished document names itself. Adopt that name unless the user has
      // already chosen one — a rename clears autoLabel, and is never overruled.
      if (data.autoLabel) {
        const title = docTitle(reply)
        if (title) update.label = title
      }
      updateNode(id, { data: update })
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [id, renderedPrompt, getNodes, getEdges, state.model, state.autoContinue,
      updateNode, data.autoLabel])

  const handleRun = useCallback(() => {
    if (loading) return
    if (!renderedPrompt) { setError('No prompt to run.'); return }
    sendTurn(LENS_KICKOFF, [])
  }, [loading, renderedPrompt, sendTurn])

  const openReader = useCallback(() => {
    // Reopening inside the exit window must cancel the pending unmount, or the
    // stale timer tears down the drawer the user has just reopened.
    clearTimeout(exitTimer.current)
    setReaderMounted(true)
    requestAnimationFrame(() => setReaderOpen(true))
  }, [])

  const closeReader = useCallback(() => {
    clearTimeout(exitTimer.current)
    setReaderOpen(false)
    exitTimer.current = setTimeout(() => setReaderMounted(false), READER_EXIT_MS)
  }, [])

  const handleRerun = useCallback(() => {
    setMenuOpen(false)
    if (loading) return
    if (!window.confirm('Re-run the original prompt? This replaces the current document and any follow-ups.')) return
    updateNode(id, { data: { messages: [] } })
    setTimeout(() => sendTurn(LENS_KICKOFF, []), 0)
  }, [id, loading, updateNode, sendTurn])

  const handleClear = useCallback(() => {
    setMenuOpen(false)
    if (!window.confirm('Clear this document and its conversation? This cannot be undone.')) return
    updateNode(id, { data: { messages: [] } })
    // closeReader, not setReaderOpen: the portal has to be scheduled for
    // unmount too, or it stays attached to the body for the node's lifetime.
    closeReader()
  }, [id, updateNode, closeReader])

  const handleDelete = useCallback(() => {
    setMenuOpen(false)
    deleteNode(id)
  }, [id, deleteNode])

  // The full record: prompt and every exchange, not just the document.
  const buildTranscript = useCallback(() => {
    const sources = connectedSources.map(n => n.data?.label || n.type).join(', ') || 'None'
    const lines = [
      `# ${data.label || 'Lens'}`, '',
      `- **Prompt template:** ${data.promptTitle || 'Custom prompt'}`,
      `- **Source(s):** ${sources}`,
      `- **Exported:** ${new Date().toISOString()}`, '',
      '---', '', '## System Prompt (rendered)', '',
      renderedPrompt || '_(none)_', '',
      '---', '', '## Document', '',
      documentMarkdown || '_(not run yet)_', '',
    ]
    return lines.join('\n')
  }, [data.label, data.promptTitle, connectedSources, renderedPrompt, documentMarkdown])

  const handleCopyTranscript = useCallback(async () => {
    setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(buildTranscript())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy — the browser blocked clipboard access.')
    }
  }, [buildTranscript])

  const handleDownload = useCallback(() => {
    setMenuOpen(false)
    const slug = (data.label || 'lens')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'lens'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const blob = new Blob([buildTranscript()], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = `${slug}-${stamp}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [buildTranscript, data.label])

  const commitTitle = useCallback(() => {
    setEditingTitle(false)
    const next = titleDraft.trim() || 'Lens'
    if (next !== data.label) updateNode(id, { data: { label: next, autoLabel: false } })
  }, [titleDraft, data.label, id, updateNode])

  // Auto-run on mount when the spawn dialog asked for it.
  const autoFiredRef = useRef(false)
  useEffect(() => {
    if (data.runOnMount && !autoFiredRef.current && messages.length === 0 && !loading) {
      autoFiredRef.current = true
      updateNode(id, { data: { runOnMount: false } })
      handleRun()
    }
    // Keyed on runOnMount alone on purpose: autoFiredRef is what guarantees a
    // single run (including under StrictMode's double invocation), so adding
    // handleRun/messages/loading would only re-enter an effect that the ref
    // already short-circuits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.runOnMount])

  // Close the ⋯ menu on any click outside it.
  //
  // Capture phase, because every control on every card calls stopPropagation to
  // keep clicks away from React Flow. A bubble-phase listener would never see a
  // click on a neighbouring card, leaving two menus open at once.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => {
      // The toggle counts as inside, or its own pointerdown would close the
      // menu a moment before its click reopens it.
      if (menuRef.current?.contains(e.target)) return
      if (menuBtnRef.current?.contains(e.target)) return
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [menuOpen])

  // ── Derived display ──────────────────────────────────────────────────────

  const sourceCount = connectedSources.length
  const status = loading ? { tone: 'busy', text: 'Working…' }
    : error ? { tone: 'err', text: 'Failed' }
    : hasStarted ? { tone: 'ok', text: '✓ Complete' }
    : sourceCount === 0 ? { tone: 'warn', text: 'No source' }
    : { tone: 'idle', text: 'Ready' }

  // Memoised because this component re-renders on any canvas-wide node or edge
  // change, and both of these walk the whole document line by line — otherwise
  // dragging one node re-parses every other card's document on every frame.
  const preview = useMemo(
    () => (hasStarted ? previewText(documentMarkdown) : previewText(renderedPrompt)),
    [hasStarted, documentMarkdown, renderedPrompt]
  )
  const meta = useMemo(
    () => (hasStarted
      ? metaLine(documentMarkdown, sourceCount)
      : `${sourceCount} source${sourceCount === 1 ? '' : 's'} · ${data.promptTitle || 'custom prompt'}`),
    [hasStarted, documentMarkdown, renderedPrompt, sourceCount, data.promptTitle]
  )

  const stop = e => e.stopPropagation()

  return (
    <div
      className={`cl-card ${selected ? 'cl-card--selected' : ''}`}
      style={{ '--nc': identity.color, position: 'relative' }}
    >
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      <div className="cl-card-head">
        <span className="cl-card-dot" />
        {/* The badge is shortened and the header may clip it further, so the
            tooltip is where the prompt's full name stays reachable. */}
        <span className="cl-card-type" title={data.promptTitle || identity.label}>{identity.label}</span>
        <span className={`cl-card-status cl-card-status--${status.tone}`}>
          {loading && <Loader size={10} className="cl-spin" />}
          {status.text}
        </span>
        <button
          ref={menuBtnRef}
          className="cl-card-menu-btn nodrag"
          onClick={e => { stop(e); setMenuOpen(o => !o) }}
          title="Node menu"
          aria-label="Node menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* The family under the name: what the border colour means, and the one
          thing this card has in common with others on the canvas. Hidden when
          it would only repeat the name — an unnamed node already wears it. */}
      {identity.family && identity.family !== identity.label && (
        <div className="cl-card-tags">
          <span className="cl-card-family">{identity.family}</span>
        </div>
      )}

      {menuOpen && (
        <div ref={menuRef} className="cl-card-menu nodrag" onClick={stop} role="menu">
          <button onClick={() => {
            setMenuOpen(false); setTitleDraft(data.label || 'Lens'); setEditingTitle(true)
          }}>
            <Pencil size={13} /> Rename
          </button>
          <button onClick={() => { setMenuOpen(false); setShowPrompt(p => !p) }}>
            <Code2 size={13} /> {showPrompt ? 'Hide prompt' : (hasStarted ? 'View prompt' : 'Edit prompt')}
          </button>
          <button onClick={handleCopyTranscript} disabled={!hasStarted}>
            {copied ? <Check size={13} /> : <Copy size={13} />} Copy transcript
          </button>
          <button onClick={handleDownload} disabled={!hasStarted}>
            <Download size={13} /> Save .md
          </button>
          <hr />
          <button onClick={handleRerun} disabled={loading || !hasStarted}>
            <RefreshCw size={13} /> Re-run original
          </button>
          <button onClick={handleClear} disabled={!hasStarted}>
            <Trash2 size={13} /> Clear document
          </button>
          <hr />
          <button className="danger" onClick={handleDelete}>
            <Trash2 size={13} /> Delete node
          </button>
        </div>
      )}

      <div className="cl-card-body">
        {editingTitle ? (
          <input
            autoFocus
            className="cl-card-title-input nodrag"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') setEditingTitle(false)
              e.stopPropagation()
            }}
            onClick={stop}
          />
        ) : (
          <h2
            className="cl-card-title"
            title="Double-click to rename"
            onDoubleClick={() => { setTitleDraft(data.label || 'Lens'); setEditingTitle(true) }}
          >
            {data.label || 'Lens'}
          </h2>
        )}

        {showPrompt && (
          hasStarted ? (
            // Read-only after a run: editing the prompt here would leave the
            // document below claiming to be its output when it no longer is.
            <div className="cl-card-prompt nodrag nopan" onClick={stop}>
              {renderedPrompt || '(no prompt)'}
            </div>
          ) : (
            <textarea
              className="cl-card-prompt nodrag nopan"
              value={renderedPrompt}
              onChange={e => updateNode(id, { data: { renderedPrompt: e.target.value } })}
              onClick={stop}
              onKeyDown={stop}
              rows={7}
              aria-label="Rendered prompt"
            />
          )
        )}

        {error ? (
          <p className="cl-card-error"><AlertCircle size={13} /> {error}</p>
        ) : preview ? (
          <p className="cl-card-preview">{preview}</p>
        ) : (
          <p className="cl-card-preview cl-card-preview--empty">
            {hasStarted ? 'This document is empty.' : 'No prompt yet — open the Prompt Library to fill this node.'}
          </p>
        )}
      </div>

      <div className="cl-card-foot">
        <span className="cl-card-meta" title={meta}>{meta}</span>
        {hasStarted ? (
          <button className="cl-card-open nodrag" onClick={e => { stop(e); openReader() }}>
            Read ⤢
          </button>
        ) : (
          <button
            className="cl-card-open nodrag"
            onClick={e => { stop(e); handleRun() }}
            disabled={loading || !renderedPrompt || sourceCount === 0}
            title={
              sourceCount === 0 ? 'Connect a source node first'
                : !renderedPrompt ? 'This node has no prompt yet'
                : 'Run the prompt against the connected source'
            }
          >
            {loading ? 'Running…' : error ? 'Retry ↻' : 'Run ▶'}
          </button>
        )}
      </div>

      {/* React Flow transforms the viewport, and a transformed ancestor makes
          position:fixed resolve against it instead of the window — so the
          reader has to live outside the flow entirely. */}
      {readerMounted && createPortal(
        <DocumentReader
          open={readerOpen}
          title={data.label || 'Document'}
          typeLabel={identity.label}
          color={identity.color}
          sourceLabel={connectedSources.map(n => n.data?.label || n.type).join(', ')}
          markdown={documentMarkdown}
          busy={loading}
          error={error}
          onClose={closeReader}
          onSendFollowUp={text => sendTurn(text, messages)}
        />,
        window.document.body
      )}
    </div>
  )
}
