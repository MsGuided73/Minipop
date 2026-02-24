import React, { useState, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Globe, ExternalLink, RefreshCw } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

export default function URLNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()
  const [urlInput, setUrlInput] = useState(data.url || '')
  const [loading, setLoading] = useState(false)

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const handleUrlSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (!urlInput.trim()) return

    let url = urlInput.trim()
    if (!url.startsWith('http')) url = 'https://' + url

    // Check if it's a YouTube URL
    const isYouTube = /youtube\.com|youtu\.be/.test(url)

    updateNode(id, {
      data: {
        url,
        label: new URL(url).hostname.replace('www.', ''),
        extractedText: `URL: ${url}\nContent from ${url} would be fetched here.`,
      }
    })
  }, [id, urlInput, updateNode])

  const getDomain = (url) => {
    try { return new URL(url).hostname.replace('www.', '') }
    catch { return url }
  }

  const getFaviconUrl = (url) => {
    try {
      const domain = new URL(url).origin
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    } catch { return null }
  }

  return (
    <div className={`node url-node ${selected ? 'node--selected' : ''}`}>
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left">
          {data.url && getFaviconUrl(data.url) ? (
            <img src={getFaviconUrl(data.url)} alt="" className="url-favicon" />
          ) : (
            <div className="node-icon node-icon--url">
              <Globe size={13} />
            </div>
          )}
          <span className="node-label truncate">
            {data.url ? getDomain(data.url) : 'Web Link'}
          </span>
        </div>
        <div className="node-actions">
          {data.url && (
            <a href={data.url} target="_blank" rel="noopener noreferrer"
               className="node-action-btn" onClick={e => e.stopPropagation()}>
              <ExternalLink size={11} />
            </a>
          )}
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* URL Input */}
      <div className="node-content">
        {!data.url ? (
          <form onSubmit={handleUrlSubmit} className="url-input-form" onClick={e => e.stopPropagation()}>
            <input
              className="url-input"
              placeholder="Paste URL here..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              autoFocus
            />
            <button type="submit" className="url-submit-btn">
              <Globe size={14} />
            </button>
          </form>
        ) : (
          <div className="url-preview">
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="url-link truncate">
              {data.url}
            </a>
            {data.extractedText && (
              <p className="url-description">
                {data.extractedText.slice(0, 120)}
                {data.extractedText.length > 120 ? '...' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {data.url && (
        <div className="node-tag node-tag--info">Web content</div>
      )}
    </div>
  )
}
