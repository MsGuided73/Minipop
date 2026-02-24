import React, { useState, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Image, Video, FileText, Edit2, Check } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

export default function MediaNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(data.label || 'Media')

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const saveLabel = useCallback(() => {
    updateNode(id, { data: { label: labelVal } })
    setEditingLabel(false)
  }, [id, labelVal, updateNode])

  const isVideo = data.mimeType?.startsWith('video/')
  const isImage = data.mimeType?.startsWith('image/')

  return (
    <div className={`node media-node ${selected ? 'node--selected' : ''}`}>
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--media">
            {isVideo ? <Video size={13} /> : isImage ? <Image size={13} /> : <FileText size={13} />}
          </div>
          {editingLabel ? (
            <input
              autoFocus
              className="node-label-input"
              value={labelVal}
              onChange={e => setLabelVal(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={e => e.key === 'Enter' && saveLabel()}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="node-label truncate" onDoubleClick={() => setEditingLabel(true)}>
              {data.label}
            </span>
          )}
        </div>
        <div className="node-actions">
          <button className="node-action-btn" onClick={() => setEditingLabel(!editingLabel)} title="Edit label">
            {editingLabel ? <Check size={11} /> : <Edit2 size={11} />}
          </button>
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete} title="Delete">
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="node-preview">
        {isImage && data.preview ? (
          <img src={data.preview} alt={data.label} className="node-preview-img" />
        ) : isVideo && data.preview ? (
          <video src={data.preview} className="node-preview-video" controls muted />
        ) : (
          <div className="node-preview-placeholder">
            <Image size={32} opacity={0.3} />
            <span>No preview</span>
          </div>
        )}
      </div>

      {/* Footer */}
      {data.size && (
        <div className="node-footer">
          <span className="node-meta">{formatBytes(data.size)}</span>
          <span className="node-meta">{data.mimeType?.split('/')[1]?.toUpperCase()}</span>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
