import React, { useState, useCallback, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Youtube, ExternalLink, Loader, FileText, AlertCircle, Edit, Check, MessageSquare, RefreshCw, Eye } from 'lucide-react'
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

// e.g. 1243891 → "1.2M", 12500 → "12.5K", 432 → "432"
function formatCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return '—'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(num)
}

// e.g. 4523s → "1:15:23", 145s → "2:25"
function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
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
  const fetchTranscript = useCallback(async (url, withComments = false, force = false) => {
    if (!url) return
    const videoId = getVideoId(url)
    if (!videoId) return

    setFetchingComments(withComments)
    if (!withComments) {
      setStatus('loading')
      setErrorMsg('')
    }

    try {
      // 1. Try Local Proxy (Fastest + Highest Rate Limits) — cache-first unless force=true
      try {
        // Use relative path so it works in both local dev (via Vite proxy) and production (via server.js)
        const localProxyUrl = `/api/transcript?url=${encodeURIComponent(url)}&includeComments=${withComments}${force ? '&force=true' : ''}`
        const localRes = await fetch(localProxyUrl)
        
        if (localRes.ok) {
          const localData = await localRes.json()
          
          const transcript = localData.transcript || 'No transcript found (Metadata-only mode)'
          const meta = localData.metadata || Object.assign({}, localData, { transcript: undefined }) 
          
          // Construct grounded text for AI
          const groundedText = [
            `VIDEO TITLE: ${meta.title || 'Unknown'}`,
            `UPLOADER: ${meta.uploader || 'Unknown'}`,
            `VIEWS: ${meta.viewCount?.toLocaleString() || 'Unknown'}`,
            `LOCKED TRANSCRIPT:`,
            transcript,
            `---`,
            meta.comments && meta.comments.length > 0 ? `AUDIENCE COMMENTS (Top 20):` : `AUDIENCE COMMENTS: Not synced.`,
            (meta.comments || []).map(c => `- [${c.author}]: ${c.text}`).join('\n')
          ].join('\n\n')

          // Trust the server's `via` so cache hits (e.g. "poppy-vps-primary-cached") surface in the UI
          const serverVia = localData.via || (withComments ? 'local-proxy-rich-comments' : 'local-proxy-fast')

          updateNode(id, {
            data: {
              label: meta.title || data.label,
              extractedText: groundedText,
              rawTranscript: transcript,
              transcriptCharCount: transcript.length,
              transcriptVia: serverVia,
              videoMetadata: meta
            }
          })

          setVia(serverVia)
          setStatus('loaded')
          setFetchingComments(false)
          return 
        } else {
           // We got a 4xx or 5xx from local proxy (probably because yt-dlp failed)
           const errJson = await localRes.json().catch(()=>({}))
           throw new Error(errJson.error || `Proxy failed with status ${localRes.status}`)
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
    } finally {
      setFetchingComments(false)
    }
  }, [id, data.label, updateNode])

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
      text: `✓ ${data.videoMetadata?.viewCount ? `${(data.videoMetadata.viewCount / 1000000).toFixed(1)}M views · ` : ''}${data.videoMetadata?.comments?.length > 0 ? '💬 Comments synced · ' : ''}Transcript loaded${charCount ? ` · ${(charCount/1000).toFixed(1)}k chars` : ''}`,
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
          {/* Open transcript as its own node (with copy/export controls) */}
          {data.rawTranscript && (
            <button
              className="node-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (window.__contentloomSpawnTranscript) {
                  window.__contentloomSpawnTranscript(id);
                }
              }}
              title="Open transcript in a new node"
            >
              <FileText size={11} />
            </button>
          )}
          {/* Force refresh: bypasses pop_transcripts cache and re-fetches from YouTube */}
          {data.url && status === 'loaded' && (
            <button
              className="node-action-btn"
              onClick={(e) => { e.stopPropagation(); fetchTranscript(data.url, false, true) }}
              title="Re-fetch transcript (bypass cache)"
            >
              <RefreshCw size={11} />
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
            <div className="youtube-thumb-gradient" />
            {via?.endsWith('-cached') && (
              <span className="youtube-cache-badge" title="Loaded from transcript cache">
                Cached
              </span>
            )}
            {formatDuration(data.videoMetadata?.duration) && (
              <span className="youtube-duration-badge">
                {formatDuration(data.videoMetadata.duration)}
              </span>
            )}
          </div>
        ) : (
          <div className="node-preview-placeholder">
            <Youtube size={32} opacity={0.3} />
            <span>No thumbnail</span>
          </div>
        )}
      </div>

      {/* Compact metadata strip + sync button */}
      {data.videoMetadata && !isEditing && (
        <>
          <div className="youtube-meta-strip">
            {data.videoMetadata.uploader && (
              <>
                <span className="youtube-meta-item" title={data.videoMetadata.uploader}>
                  <Youtube size={11} color="#ff4070" />
                  <span className="meta-value truncate" style={{ maxWidth: 110 }}>
                    {data.videoMetadata.uploader}
                  </span>
                </span>
                <span className="youtube-meta-sep">·</span>
              </>
            )}
            <span className="youtube-meta-item" title={`${(data.videoMetadata.viewCount || 0).toLocaleString()} views`}>
              <Eye size={11} />
              <span className="meta-value">{formatCount(data.videoMetadata.viewCount)}</span>
            </span>
            {data.videoMetadata.comments?.length > 0 && (
              <span className="youtube-comments-pill" title={`${data.videoMetadata.comments.length} comments synced`}>
                <MessageSquare size={10} />
                {data.videoMetadata.comments.length}
              </span>
            )}
          </div>

          {!(data.videoMetadata.comments?.length > 0) && (
            <button
              className="youtube-sync-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (fetchingComments) return;
                setFetchingComments(true);
                fetchTranscript(data.url, true);
              }}
              disabled={fetchingComments}
            >
              {fetchingComments ? (
                <><Loader size={11} className="spin" /> Fetching audience comments…</>
              ) : (
                <><MessageSquare size={11} /> Sync audience comments</>
              )}
            </button>
          )}
        </>
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
