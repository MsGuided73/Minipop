import React, { useState, useCallback, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Youtube, ExternalLink, Loader, FileText, AlertCircle } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

// Supabase Edge Function — server-side transcript fetcher (no CORS issues)
const TRANSCRIPT_API = 'https://dfcppzpppqgphjjxypyw.supabase.co/functions/v1/youtube-transcript'

function getVideoId(url) {
  try {
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)
    return match?.[1] || null
  } catch { return null }
}

function getThumbnailUrl(url) {
  const id = getVideoId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

export default function YouTubeNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()

  // Derive initial status from already-stored data
  const hasRealTranscript = Boolean(
    data.extractedText &&
    !data.extractedText.startsWith('YouTube video URL:') &&
    data.extractedText !== `URL: ${data.url}`
  )
  const [status, setStatus] = useState(hasRealTranscript ? 'loaded' : 'idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [via, setVia] = useState(data.transcriptVia || '')

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const fetchTranscript = useCallback(async (url) => {
    const videoId = getVideoId(url)
    if (!videoId) return

    setStatus('loading')
    setErrorMsg('')

    try {
      const res = await fetch(`${TRANSCRIPT_API}?videoId=${videoId}`)
      const json = await res.json()

      if (json.transcript && json.transcript.length > 50) {
        updateNode(id, {
          data: {
            extractedText: json.transcript,
            transcriptCharCount: json.charCount,
            transcriptVia: json.via || 'unknown',
          }
        })
        setVia(json.via || '')
        setStatus('loaded')
      } else {
        const msg = json.error || 'No transcript available'
        setErrorMsg(msg)
        // Still store the URL so AI can reason about it
        updateNode(id, {
          data: {
            extractedText: `YouTube Video URL: ${url}\nVideo ID: ${videoId}\nNote: Auto-transcript unavailable (${msg}). AI will summarize using training knowledge.`,
          }
        })
        setStatus('failed')
      }
    } catch (err) {
      const msg = err.message || 'Network error'
      setErrorMsg(msg)
      updateNode(id, {
        data: {
          extractedText: `YouTube Video URL: ${url}\nVideo ID: ${videoId}\nNote: Transcript fetch failed (${msg}).`,
        }
      })
      setStatus('failed')
    }
  }, [id, updateNode])

  // Auto-fetch when node loads with a URL but no real transcript yet
  useEffect(() => {
    if (data.url && !hasRealTranscript && status === 'idle') {
      fetchTranscript(data.url)
    }
  }, [data.url]) // eslint-disable-line react-hooks/exhaustive-deps

  const thumbnail = getThumbnailUrl(data.url || '')
  const charCount = data.transcriptCharCount || 0

  const statusConfig = {
    idle:    null,
    loading: { icon: <Loader size={10} className="spin" />, text: 'Fetching transcript…',  cls: 'node-tag--loading' },
    loaded:  { icon: <FileText size={10} />,                text: `✓ Transcript loaded${charCount ? ` · ${(charCount/1000).toFixed(1)}k chars` : ''}${via ? ` · ${via}` : ''}`, cls: 'node-tag--success' },
    failed:  { icon: <AlertCircle size={10} />,             text: 'No transcript — URL-only mode', cls: 'node-tag--warning' },
  }[status]

  return (
    <div className={`node youtube-node ${selected ? 'node--selected' : ''}`}>
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--youtube">
            <Youtube size={13} />
          </div>
          <span className="node-label truncate">{data.label || 'YouTube Video'}</span>
        </div>
        <div className="node-actions">
          {/* Manual retry button if failed */}
          {status === 'failed' && data.url && (
            <button
              className="node-action-btn"
              onClick={(e) => { e.stopPropagation(); fetchTranscript(data.url) }}
              title="Retry transcript fetch"
            >
              <Loader size={11} />
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

      {/* Thumbnail */}
      <div className="node-preview">
        {thumbnail ? (
          <div className="youtube-thumb-wrap">
            <img src={thumbnail} alt={data.label} className="node-preview-img" />
            <div className="youtube-play-btn">
              <svg viewBox="0 0 24 24" fill="white" width="32" height="32">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
        ) : (
          <div className="node-preview-placeholder">
            <Youtube size={32} opacity={0.3} />
            <span>No thumbnail</span>
          </div>
        )}
      </div>

      {/* URL */}
      {data.url && (
        <div className="node-footer">
          <span className="node-meta truncate">{data.url}</span>
        </div>
      )}

      {/* Status badge */}
      {statusConfig && (
        <div className={`node-tag ${statusConfig.cls}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {statusConfig.icon}
          {statusConfig.text}
        </div>
      )}

      {/* Error detail */}
      {status === 'failed' && errorMsg && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '0 10px 6px', lineHeight: 1.4 }}>
          {errorMsg.length > 80 ? errorMsg.slice(0, 80) + '…' : errorMsg}
        </div>
      )}
    </div>
  )
}
