import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { NodeResizer } from '@xyflow/react'
import { Layers } from 'lucide-react'

const GroupNode = ({ data, selected }) => {
  return (
    <>
      <NodeResizer 
        color="var(--accent-primary, #7c5cfc)"
        isVisible={selected}
        minWidth={200}
        minHeight={150}
      />
      <div 
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--bg-modifier-hover, rgba(255, 255, 255, 0.03))',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: `2px dashed ${selected ? 'var(--accent-primary, #7c5cfc)' : 'var(--border-default, #30363d)'}`,
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none', // Allow clicking through to children when not clicking the header
        }}
      >
        <div 
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-default, #30363d)',
            backgroundColor: 'var(--bg-surface, #161b22)',
            borderTopLeftRadius: 'calc(var(--radius-lg, 12px) - 2px)',
            borderTopRightRadius: 'calc(var(--radius-lg, 12px) - 2px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-secondary, #8b949e)',
            fontSize: '12px',
            fontWeight: 600,
            pointerEvents: 'all', // header is draggable
          }}
        >
          <Layers size={14} />
          {data.label || 'Information Group'}
        </div>
        
        {/* Connection Handles (Target on Left, Source on Right) */}
        <Handle 
          type="target" 
          position={Position.Left} 
          style={{ zIndex: 10, pointerEvents: 'all' }}
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          style={{ zIndex: 10, pointerEvents: 'all' }}
        />
      </div>
    </>
  )
}

export default memo(GroupNode)
