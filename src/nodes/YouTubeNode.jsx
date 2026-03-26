import React, { useState, useCallback, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Youtube, ExternalLink, Loader, FileText, AlertCircle, Edit, Check, MessageSquare } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

// Supabase Edge Function — server-side transcript fetcher (no CORS issues)
const TRANSCRIPT_API = 'https://dfcppzpppqgphjjxypyw.supabase.co/functions/v1/youtube-transcript'

function getVideoId(url) {
  try {
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)
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
    !data.extractedText.toLowerCase().startsWith('youtube video url:') &&
    data.extractedText !== `URL: ${data.url}`
  )
  const [fetchingComments, setFetchingComments] = useState(false)
  const [status, setStatus] = useState(hasRealTranscript ? 'loaded' : 'idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [via, setVia] = useState(data.transcriptVia || '')
  const [isEditing, setIsEditing] = useState(false)
  const [manualText, setManualText] = useState(data.extractedText || '')

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const fetchTranscript = useCallback(async (url, withComments = false) => {
    const videoId = getVideoId(url)
    if (!videoId) return

    if (!withComments) {
      setStatus('loading')
    }
    setErrorMsg('')

    try {
      // 1. Try Local Proxy first (Bypasses IP blocks via residential connection)
      try {
        const query = `videoId=${videoId}${withComments ? '&includeComments=true' : ''}`
        const localResponse = await fetch(`/api/transcript?${query}`)
        
        if (localResponse.ok) {
          const localData = await localResponse.json()
          
          const transcript = localData.transcript || 'No transcript found (Metadata-only mode)'
          const meta = localData.metadata || {}
          
          // Construct grounded text for AI
          const groundedText = [
            `VIDEO TITLE: ${meta.title || 'Unknown'}`,
            `UPLOADER: ${meta.uploader || 'Unknown'}`,
            `VIEWS: ${meta.viewCount?.toLocaleString() || 'Unknown'}`,
            `LOCKED TRANSCRIPT:`,
            transcript,
            `---`,
            meta.comments?.length > 0 ? `AUDIENCE COMMENTS (Top 20):` : `AUDIENCE COMMENTS: Not synced.`,
            (meta.comments || []).map(c => `- [${c.author}]: ${c.text}`).join('\n')
          ].join('\n\n')

          updateNode(id, {
            data: {
              label: meta.title || data.label,
              extractedText: groundedText,
              transcriptCharCount: transcript.length,
              transcriptVia: withComments ? 'local-proxy-rich-comments' : 'local-proxy-fast',
              videoMetadata: meta
            }
          })
          
          setVia(withComments ? 'local-proxy-rich-comments' : 'local-proxy-fast')
          setStatus('loaded')
          setFetchingComments(false)
          return 
        }
      } catch (e) {
        console.warn('Local transcript proxy failed, falling back...', e)
      }

      // 2. Fallback to Supabase Edge Function (Cloud Fetcher)
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
        const detail = json.detail || ''
        setErrorMsg(detail ? `${msg} (${detail})` : msg)
        // Still store the URL so AI can reason about it
        updateNode(id, {
          data: {
            extractedText: `YouTube Video URL: ${url}\nVideo ID: ${videoId}\nNote: Auto-transcript unavailable (${msg}). ${detail ? `Details: ${detail}` : ''} AI will summarize using training knowledge.`,
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
    loaded:  { 
      icon: <FileText size={10} />, 
      text: `✓ ${data.metadata?.viewCount ? `${(data.metadata.viewCount / 1000000).toFixed(1)}M views · ` : ''}${data.metadata?.comments?.length > 0 ? '💬 Comments synced · ' : ''}Transcript loaded${charCount ? ` · ${(charCount/1000).toFixed(1)}k chars` : ''}`, 
      cls: 'node-tag--success' 
    },
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
          <button 
            className={`node-action-btn ${isEditing ? 'node-action-btn--success' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (isEditing) {
                updateNode(id, { data: { extractedText: manualText, transcriptCharCount: manualText.length, transcriptVia: 'manual' } });
                setStatus('loaded');
                setVia('manual');
              }
              setIsEditing(!isEditing);
            }}
            title={isEditing ? "Save Transcript" : "Edit Transcript Manually"}
          >
            {isEditing ? <Check size={11} /> : <Edit size={11} />}
          </button>
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Thumbnail or Edit Area */}
      <div className="node-preview">
        {isEditing ? (
          <textarea
            className="node-edit-area"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Paste transcript here..."
            onClick={e => e.stopPropagation()}
          />
        ) : thumbnail ? (
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

      {/* Metadata Summary (if available) */}
      {data.videoMetadata && !isEditing && (
        <div className="youtube-node-metadata">
          <div className="meta-row">
            <span className="meta-label">Uploader:</span>
            <span className="meta-value truncate">{data.videoMetadata.uploader}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Views:</span>
            <span className="meta-value">{(data.videoMetadata.viewCount || 0).toLocaleString()}</span>
          </div>
          
          {/* Comments Section / Sync Button */}
          {data.videoMetadata.comments?.length > 0 ? (
            <div className="meta-row meta-success">
              <MessageSquare size={10} />
              <span>{data.videoMetadata.comments.length} comments synced</span>
            </div>
          ) : (
            <button 
              className="sync-comments-btn" 
              onClick={(e) => {
                e.stopPropagation();
                if (fetchingComments) return;
                setFetchingComments(true);
                fetchTranscript(data.url, true); // True to include comments
              }}
              disabled={fetchingComments}
            >
              {fetchingComments ? (
                <><Loader size={10} className="animate-spin" /> Fetching...</>
              ) : (
                <><MessageSquare size={10} /> Sync Comments (Slow)</>
              )}
            </button>
          )}
        </div>
      )}

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
