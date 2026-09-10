import React, { useCallback, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, useStore } from '@xyflow/react'
import { identityFor } from '../lib/nodeIdentity'

// An edge takes the colour of what it produces, not what it came from: reading
// down the canvas, the arrow into a Video Script is rose all the way, so the
// shape of the graph is legible at a zoom where no label is.
function useTargetIdentityKey(target) {
  return useStore(
    useCallback(
      (s) => {
        const node = s.nodeLookup?.get(target)
        return identityFor({
          promptTitle: node?.data?.promptTitle,
          promptTags: node?.data?.promptTags,
          nodeType: node?.type,
        }).key
      },
      [target]
    )
  )
}

export default function SemanticEdge({
  id, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data, selected
}) {
  const { setEdges } = useReactFlow()

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition
  })

  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(data?.label || '')

  const identityKey = useTargetIdentityKey(target)
  // The identity keys and the palette's variable names are deliberately the
  // same words, so a new node type needs no entry here.
  const color = identityKey === 'default' ? 'var(--accent)' : `var(--c-${identityKey})`
  const markerEnd = `url(#cl-arrow-${identityKey})`

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
          // Derived colour wins over anything saved on the edge: boards written
          // before the redesign carry a hard-coded purple stroke.
          stroke: selected ? 'var(--accent)' : color,
          strokeWidth: selected ? 3 : 1.8,
          opacity: selected ? 1 : 0.7,
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
                background: 'var(--panel)',
                color: 'var(--ink)',
                border: `1px solid ${color}`,
                borderRadius: 'var(--r-control)',
                padding: '2px 8px',
                fontSize: '11px',
                fontFamily: 'var(--font-ui)',
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
                background: label ? 'var(--panel)' : (showPlaceholder ? 'rgba(0,0,0,0.5)' : 'transparent'),
                color: label ? 'var(--ink)' : 'var(--faint)',
                border: label ? `1px solid ${color}` : (showPlaceholder ? '1px dashed var(--line)' : 'none'),
                borderRadius: 'var(--r-pill)',
                padding: label || showPlaceholder ? '3px 8px' : '10px', /* Larger invisible hit area when empty */
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'var(--font-ui)',
                cursor: 'text',
                boxShadow: label ? 'var(--shadow-card)' : 'none',
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
