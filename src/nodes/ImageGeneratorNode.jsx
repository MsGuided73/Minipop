import React, { useState, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Image as ImageIcon, Loader, Wand2, RefreshCw } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

export default function ImageGeneratorNode({ id, data, selected }) {
  const { state, updateNode, generateImage } = useCanvas()
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
        prompt,
        extractedText: `Generated Image Prompt: ${prompt}`,
        preview: base64Image,
      })
    } catch (err) {
      setError(err.message || 'Failed to generate image')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, id, state.apiKey, state.model, state.geminiKey, generateImage, updateNode])

  return (
    <div className={`node ai-node ${selected ? 'selected' : ''}`} style={{ minHeight: '180px' }}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      
      {/* Header */}
      <div className="node-header ai-node-header">
        <div className="node-header-left">
          <div className="node-icon-bg" style={{ background: 'var(--node-ai)' }}>
            <ImageIcon size={14} color="var(--accent-primary)" />
          </div>
          <span className="node-title">{data.label || 'Image Gen'}</span>
        </div>
      </div>

      {/* Content */}
      <div className="node-content">
        {data.preview ? (
          <div className="media-preview-wrap" style={{ position: 'relative' }}>
            <img src={data.preview} alt="Generated" className="media-preview-img" style={{ maxHeight: '200px', width: '100%', objectFit: 'cover', borderRadius: '4px' }} />
            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <strong>Prompt:</strong> {data.prompt}
            </div>
            <button 
              className="btn btn-ghost" 
              style={{ width: '100%', marginTop: '8px', fontSize: '11px', display: 'flex', justifyContent: 'center', gap: '4px' }}
              onClick={() => updateNode(id, { preview: null })}
            >
              <RefreshCw size={11} /> New Image
            </button>
          </div>
        ) : (
          <div className="ai-input-wrap">
            <textarea
              className="ai-input nodrag nopan"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate (e.g., A futuristic city overhead...)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleGenerate()
                }
                e.stopPropagation()
              }}
              style={{ minHeight: '80px', resize: 'none' }}
            />
            
            {error && <div style={{ color: '#ff6b6b', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>{error}</div>}
            
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '8px', display: 'flex', justifyContent: 'center', gap: '6px' }}
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? <Loader size={13} className="spin" /> : <Wand2 size={13} />}
              {isGenerating ? 'Generating...' : 'Generate Image'}
            </button>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}
