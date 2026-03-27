import React, { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow } from '@xyflow/react'

export default function SemanticEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data, selected
}) {
  const { setEdges } = useReactFlow()
  
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition
  })
  
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(data?.label || '')

  const onLabelChange = (e) => {
    setLabel(e.target.value)
  }

  const onBlur = () => {
    setIsEditing(false)
    setEdges(eds => eds.map(e => e.id === id ? { ...e, data: { ...e.data, label } } : e))
  }

  const showPlaceholder = !label && selected

  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{ 
          ...style, 
          stroke: selected ? 'var(--accent-primary)' : style?.stroke, 
          strokeWidth: selected ? 3 : (style?.strokeWidth || 2) 
        }} 
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: selected ? 100 : 10
          }}
          className="nodrag nopan"
        >
          {isEditing ? (
            <input
              autoFocus
              value={label}
              onChange={onLabelChange}
              onBlur={onBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onBlur()
                e.stopPropagation()
              }}
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--accent-primary)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '11px',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
                width: `${Math.max(80, label.length * 8)}px`,
                textAlign: 'center'
              }}
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
              style={{
                background: label ? 'var(--bg-card)' : (showPlaceholder ? 'rgba(0,0,0,0.5)' : 'transparent'),
                color: label ? 'var(--text-primary)' : 'var(--text-muted)',
                border: label ? '1px solid var(--border-default)' : (showPlaceholder ? '1px dashed var(--border-subtle)' : 'none'),
                borderRadius: '12px',
                padding: label || showPlaceholder ? '3px 8px' : '10px', /* Larger invisible hit area when empty */
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: 'text',
                boxShadow: label ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
                transition: 'all 0.2s ease',
                opacity: label || showPlaceholder ? 1 : 0
              }}
              title="Double-click to add relationship label"
            >
              {label || (showPlaceholder ? '+ Label' : '.')}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
