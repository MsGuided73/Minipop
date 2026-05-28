import React, { useState, useCallback, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, Type, Edit2, Check } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function TextNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()
  const [editingContent, setEditingContent] = useState(false)
  const [contentVal, setContentVal] = useState(data.content || '')
  const [labelVal, setLabelVal] = useState(data.label || 'Note')
  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 13 })

  // Keep local state in sync if data changes externally
  useEffect(() => {
    setContentVal(data.content || '')
  }, [data.content])

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const saveContent = useCallback((val) => {
    // Save both content AND extractedText so the AI can read it
    updateNode(id, {
      data: {
        content: val,
        extractedText: val,   // ← this is what the AI reads
        label: labelVal,
      }
    })
  }, [id, labelVal, updateNode])

  const handleContentChange = useCallback((e) => {
    const val = e.target.value
    setContentVal(val)
    // Debounce save — update context after typing stops for 300ms
    clearTimeout(window._textNodeSaveTimer)
    window._textNodeSaveTimer = setTimeout(() => saveContent(val), 300)
  }, [saveContent])

  const handleFinishEditing = useCallback(() => {
    saveContent(contentVal)
    setEditingContent(false)
  }, [contentVal, saveContent])

  const handleLabelBlur = useCallback(() => {
    updateNode(id, { data: { label: labelVal } })
  }, [id, labelVal, updateNode])

  return (
    <div className={`node text-node ${selected ? 'node--selected' : ''}`}>
      <Handle type="source" position={Position.Right} id="source" />
      <Handle type="target" position={Position.Left} id="target" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--text">
            <Type size={13} />
          </div>
          <input
            className="node-label-input"
            value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            onBlur={handleLabelBlur}
            onClick={e => e.stopPropagation()}
          />
        </div>
        <div className="node-actions">
          <button
            className="node-action-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (editingContent) {
                handleFinishEditing()
              } else {
                setEditingContent(true)
              }
            }}
            title={editingContent ? 'Save' : 'Edit'}
          >
            {editingContent ? <Check size={11} /> : <Edit2 size={11} />}
          </button>
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Reader bar shows only in read mode with content */}
      {!editingContent && contentVal && (
        <NodeReaderBar
          reader={reader}
          placeholder="Find in note…"
          matchCount={reader.countMatches(contentVal)}
          compact
        />
      )}

      {/* Content */}
      <div className="node-content text-node-content">
        {editingContent ? (
          <textarea
            autoFocus
            className="text-node-textarea nopan"
            value={contentVal}
            onChange={handleContentChange}
            onBlur={handleFinishEditing}
            onClick={e => e.stopPropagation()}
            placeholder="Type your notes here... The AI can read this!"
            rows={5}
            style={{ fontSize: reader.fontSize }}
          />
        ) : (
          <div
            className="text-node-display nopan"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingContent(true) }}
            title="Double-click to edit"
            style={{ fontSize: reader.fontSize }}
          >
            {contentVal
              ? reader.highlight(contentVal)
              : <span className="text-muted">Double-click to add text...</span>
            }
          </div>
        )}
      </div>

      {/* Show AI-readable indicator when content exists */}
      {contentVal && !editingContent && (
        <div className="node-tag node-tag--success">✓ AI can read this</div>
      )}
    </div>
  )
}
