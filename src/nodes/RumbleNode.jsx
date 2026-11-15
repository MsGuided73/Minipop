import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { X, Video, ExternalLink, Loader, FileText, AlertCircle, RefreshCw, Eye } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { apiFetch } from '../services/apiClient'
import './nodes.css'

const POLL_MS = 3000

// e.g. 1243891 → "1.2M", 12500 → "12.5K"
function formatCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return '—'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(num)
}

function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

async function errorFrom(res) {
  const body = await res.json().catch(() => ({}))
  const message = [body.error, body.detail].filter(Boolean).join(' — ')
  return new Error(message || `Request failed (HTTP ${res.status})`)
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export default function RumbleNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()

  const [status, setStatus] = useState(data.rawTranscript ? 'loaded' : 'idle')
  const [stage, setStage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  // Cleared on unmount so a poll never writes to a node that is gone.
  const aliveRef = useRef(true)
  const startedRef = useRef(false)

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const finish = useCallback((result) => {
    const meta = result.metadata || {}
    // Same shape the YouTube node writes, so a prompt reads it the same way.
    const groundedText = [
      `VIDEO TITLE: ${meta.title || 'Unknown'}`,
      `UPLOADER: ${meta.uploader || 'Unknown'}`,
      `VIEWS: ${meta.viewCount?.toLocaleString() || 'Unknown'}`,
      `LOCKED TRANSCRIPT:`,
      result.transcript,
    ].join('\n\n')

    updateNode(id, {
      data: {
        label: meta.title || data.label,
        extractedText: groundedText,
        rawTranscript: result.transcript,
        transcriptCharCount: result.transcript.length,
        transcriptVia: result.via || 'rumble',
        videoMetadata: meta,
      },
    })
    setStatus('loaded')
  }, [id, data.label, updateNode])

  const transcribe = useCallback(async (force = false) => {
    if (!data.url) return
    setStatus('loading')
    setStage('Starting…')
    setErrorMsg('')

    try {
      const res = await apiFetch('/api/v1/rumble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: data.url, force }),
      })
      if (!res.ok) throw await errorFrom(res)
      let job = await res.json()
      const jobId = job.jobId

      while (job.status === 'running') {
        await wait(POLL_MS)
        if (!aliveRef.current) return
        const poll = await apiFetch(`/api/v1/rumble/${jobId}`)
        if (!poll.ok) throw await errorFrom(poll)
        job = await poll.json()
        if (job.stage) setStage(job.stage)
      }

      if (job.status === 'failed') throw new Error(job.error || 'Transcription failed')
      if (aliveRef.current) finish(job)
    } catch (err) {
      if (!aliveRef.current) return
      setErrorMsg(err.message || 'Could not transcribe this video')
      setStatus('failed')
    }
  }, [data.url, finish])

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // A freshly dropped node has a URL and no transcript yet: start straight away.
  useEffect(() => {
    if (data.url && !data.rawTranscript && !startedRef.current) {
      startedRef.current = true
      transcribe()
    }
  }, [data.url, data.rawTranscript, transcribe])

  const meta = data.videoMetadata
  const charCount = data.transcriptCharCount || 0
  const duration = formatDuration(meta?.duration)

  const statusConfig = {
    idle: null,
    loading: { icon: <Loader size={10} className="spin" />, text: stage || 'Transcribing…', cls: 'node-tag--loading' },
    loaded: {
      icon: <FileText size={10} />,
      text: `✓ Transcript ready${charCount ? ` · ${(charCount / 1000).toFixed(1)}k chars` : ''}`,
      cls: 'node-tag--success',
    },
    failed: { icon: <AlertCircle size={10} />, text: 'Could not transcribe', cls: 'node-tag--warning' },
  }[status]

  return (
    <div
      className={`node youtube-node ${selected ? 'node--selected' : ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      <NodeResizer minWidth={280} minHeight={260} isVisible={selected} />
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      <div className="node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--rumble">
            <Video size={13} />
          </div>
          <span className="node-label truncate">{data.label || 'Rumble Video'}</span>
        </div>
        <div className="node-actions">
          {status === 'failed' && (
            <button
              className="node-action-btn"
              onClick={(e) => { e.stopPropagation(); transcribe() }}
              title="Try again"
            >
              <Loader size={11} />
            </button>
          )}
          {data.rawTranscript && (
            <button
              className="node-action-btn"
              onClick={(e) => {
                e.stopPropagation()
                window.__contentloomSpawnTranscript?.(id)
              }}
              title="Open transcript in a new node"
            >
              <FileText size={11} />
            </button>
          )}
          {status === 'loaded' && (
            <button
              className="node-action-btn"
              onClick={(e) => { e.stopPropagation(); transcribe(true) }}
              title="Transcribe again (uses your API key)"
            >
              <RefreshCw size={11} />
            </button>
          )}
          {data.url && (
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="node-action-btn" onClick={e => e.stopPropagation()}>
              <ExternalLink size={11} />
            </a>
          )}
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="node-preview">
        {meta?.thumbnail ? (
          <div className="youtube-thumb-wrap">
            <img src={meta.thumbnail} alt={data.label} className="node-preview-img" referrerPolicy="no-referrer" />
            <div className="youtube-thumb-gradient" />
            {data.transcriptVia?.endsWith('-cached') && (
              <span className="youtube-cache-badge" title="Loaded from transcript cache">Cached</span>
            )}
            {duration && <span className="youtube-duration-badge">{duration}</span>}
          </div>
        ) : (
          <div className="node-preview-placeholder">
            <Video size={32} opacity={0.3} />
            <span>{status === 'loading' ? 'Working…' : 'No thumbnail'}</span>
          </div>
        )}
      </div>

      {meta && (
        <div className="youtube-meta-strip">
          {meta.uploader && (
            <>
              <span className="youtube-meta-item" title={meta.uploader}>
                <Video size={11} color="#85c742" />
                <span className="meta-value truncate" style={{ maxWidth: 110 }}>{meta.uploader}</span>
              </span>
              <span className="youtube-meta-sep">·</span>
            </>
          )}
          <span className="youtube-meta-item" title={`${(meta.viewCount || 0).toLocaleString()} views`}>
            <Eye size={11} />
            <span className="meta-value">{formatCount(meta.viewCount)}</span>
          </span>
        </div>
      )}

      {data.url && (
        <div className="node-footer">
          <span className="node-meta truncate">{data.url}</span>
        </div>
      )}

      {statusConfig && (
        <div className={`node-tag ${statusConfig.cls}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {statusConfig.icon}
          {statusConfig.text}
        </div>
      )}

      {status === 'failed' && errorMsg && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '0 10px 6px', lineHeight: 1.4 }}>
          {errorMsg.length > 140 ? errorMsg.slice(0, 140) + '…' : errorMsg}
        </div>
      )}
    </div>
  )
}
