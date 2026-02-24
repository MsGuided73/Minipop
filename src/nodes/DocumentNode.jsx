import React, { useState, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, FileText, Download } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

export default function DocumentNode({ id, data, selected }) {
  const { deleteNode } = useCanvas()

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const ext = data.label?.split('.').pop()?.toUpperCase() || 'DOC'

  return (
    <div className={`node document-node ${selected ? 'node--selected' : ''}`}>
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--document">
            <FileText size={13} />
          </div>
          <span className="node-label truncate">{data.label}</span>
        </div>
        <div className="node-actions">
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* File preview */}
      <div className="node-content">
        <div className="document-preview">
          <div className="document-icon-large">
            <FileText size={40} strokeWidth={1.5} />
            <span className="document-ext">{ext}</span>
          </div>
          {data.size && (
            <span className="document-size">{formatBytes(data.size)}</span>
          )}
        </div>
      </div>

      {/* Content preview */}
      {data.extractedText && (
        <div className="document-text-preview">
          <p>{data.extractedText.slice(0, 180)}
            {data.extractedText.length > 180 ? '...' : ''}
          </p>
        </div>
      )}

      <div className="node-tag node-tag--default">
        {data.mimeType || 'Document'}
      </div>
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
