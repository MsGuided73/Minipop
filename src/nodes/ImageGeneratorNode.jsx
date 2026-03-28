import React, { useState, useCallback } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { Image as ImageIcon, Loader, Wand2, RefreshCw } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { generateImage } from '../services/aiService'
import './nodes.css'

export default function ImageGeneratorNode({ id, data, selected }) {
  const { state, updateNode } = useCanvas()
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState(null)

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setIsGenerating(true)
    setError(null)
    
    try {
      const base64Image = await generateImage(prompt, state.apiKey, state.model, state.geminiKey)
      
      updateNode(id, {
        data: {
          prompt,
          extractedText: `Generated Image Prompt: ${prompt}`,
          preview: base64Image,
        }
      })
    } catch (err) {
      setError(err.message || 'Failed to generate image')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, id, state.apiKey, state.model, state.geminiKey, updateNode])

  return (
    <div className={`node ai-node ${selected ? 'selected' : ''}`} style={{ width: '100%', height: '100%', minWidth: '320px', minHeight: '340px' }}>
      <NodeResizer minWidth={320} minHeight={340} isVisible={selected} lineClassName="border-blue-400" handleClassName="h-3 w-3 bg-white border-2 rounded" />
      <Handle type="target" position={Position.Left} className="node-handle" />
      
      {/* Header */}
      <div className="node-header ai-node-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="node-header-left">
          <div className="node-icon-bg" style={{ background: 'var(--node-ai)' }}>
            <ImageIcon size={14} color="var(--accent-primary)" />
          </div>
          <span className="node-title">{data.label || 'Image Gen'}</span>
        </div>
        
        {data.preview && (
          <button 
            className="btn btn-ghost" 
            style={{ padding: '2px 6px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => updateNode(id, { data: { preview: null } })}
            title="Clear Image"
          >
            <RefreshCw size={10} /> Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div className="node-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        
        {/* Dedicated Image Preview Frame */}
        <div 
          className="media-preview-wrap" 
          style={{ 
            position: 'relative', 
            width: '100%', 
            height: '220px', 
            backgroundColor: 'var(--bg-secondary)', 
            borderRadius: '8px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          {data.preview ? (
             <img 
                src={data.preview} 
                alt="AI Generated" 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
             />
          ) : (
             <div style={{ color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
               <ImageIcon size={28} opacity={0.4} />
               <span style={{ fontSize: '11px', fontWeight: '500', opacity: 0.6 }}>Output Frame</span>
             </div>
          )}
        </div>

        {/* Input Area */}
        <div className="ai-input-wrap">
          <textarea
            className="ai-input nodrag nopan"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image (e.g., A sprawling neo-tokyo cityscape at dusk...)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleGenerate()
              }
              e.stopPropagation()
            }}
            style={{ 
              width: '100%', 
              minHeight: '70px', 
              resize: 'none', 
              padding: '10px',
              fontSize: '12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px'
            }}
          />
          
          {error && <div style={{ color: '#ff6b6b', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>{error}</div>}
          
          <button
            className="btn btn-primary"
            style={{ 
              width: '100%', 
              marginTop: '10px', 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: '6px',
              padding: '8px 0' 
            }}
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? <Loader size={14} className="spin" /> : <Wand2 size={14} />}
            {isGenerating ? 'Synthesizing...' : 'Generate Image'}
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}
