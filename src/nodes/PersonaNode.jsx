import React, { useState, useCallback } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { X, UserSquare, Shield, Target, MessageSquare, Zap, Check, Save } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function PersonaNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()
  const [isEditing, setIsEditing] = useState(false)

  // Local state for form fields to avoid excessive re-renders on the canvas
  const [formData, setFormData] = useState({
    name: data.name || 'New Persona',
    tone: data.tone || 'Professional',
    customTone: data.customTone || '',
    audience: data.audience || '',
    styleProfile: data.styleProfile || '',
    rules: data.rules || '',
    forbidden: data.forbidden || ''
  })

  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 11 })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSave = () => {
    updateNode(id, { 
      data: { 
        ...data,
        ...formData,
        label: formData.name,
        // The grounded text for AI injection
        extractedText: `--- PERSONA: ${formData.name} ---
TONE: ${formData.tone === 'Custom' ? formData.customTone : formData.tone}
AUDIENCE: ${formData.audience}
STYLE PROFILE: ${formData.styleProfile}
SPECIFIC RULES: ${formData.rules}
FORBIDDEN: ${formData.forbidden}
`
      } 
    })
    setIsEditing(false)
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    deleteNode(id)
  }

  return (
    <div
      className={`node persona-node ${selected ? 'node--selected' : ''}`}
      style={{ width: '100%', height: '100%', minWidth: 280, minHeight: isEditing ? 420 : (formData.styleProfile ? 340 : 200) }}
    >
      <NodeResizer minWidth={280} minHeight={isEditing ? 420 : (formData.styleProfile ? 340 : 200)} isVisible={selected} />
      {/* Target/Source handles */}
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      {/* Header */}
      <div className="node-header persona-node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--persona">
            <UserSquare size={13} />
          </div>
          <div className="ai-header-info">
            <span className="node-label">{formData.name}</span>
            <span className="ai-node-subtitle">Brand Persona</span>
          </div>
        </div>
        <div className="node-actions">
          <button className="node-action-btn" onClick={() => setIsEditing(!isEditing)}>
            <Zap size={11} color={isEditing ? 'var(--accent-primary)' : 'currentColor'} />
          </button>
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="persona-content node-scrollable nopan" onClick={e => e.stopPropagation()}>
        {isEditing ? (
          <div className="persona-form">
            <div className="form-group">
              <label>Persona Name</label>
              <input name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Premium Founder" />
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label>Tone</label>
                <select name="tone" value={formData.tone} onChange={handleChange}>
                  <option>Professional</option>
                  <option>Casual</option>
                  <option>Bold/Punchy</option>
                  <option>Expert/Deep</option>
                  <option>Custom</option>
                </select>
              </div>
              {formData.tone === 'Custom' && (
                <div className="form-group flex-1">
                  <label>Custom Tone</label>
                  <input name="customTone" value={formData.customTone} onChange={handleChange} placeholder="e.g. Sarcastic Dev" />
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Target Audience (ICP)</label>
              <input name="audience" value={formData.audience} onChange={handleChange} placeholder="e.g. Startup Founders, Gen Z" />
            </div>

            <div className="form-group">
              <label>Writing Style Profile (Copy/Paste)</label>
              <textarea 
                name="styleProfile" 
                value={formData.styleProfile} 
                onChange={handleChange} 
                placeholder="Paste your style guide or example writing here..."
                rows={5}
              />
            </div>

            <div className="form-group">
              <label>Specific Instructions</label>
              <textarea name="rules" value={formData.rules} onChange={handleChange} placeholder="e.g. Use emojis, short sentences" rows={3} />
            </div>

            <button className="btn btn-primary persona-save-btn" onClick={handleSave}>
              <Save size={14} /> Update Persona
            </button>
          </div>
        ) : (
          <div className="persona-preview">
            <div className="preview-item">
              <Target size={12} />
              <span><strong>Audience:</strong> {formData.audience || 'General'}</span>
            </div>
            <div className="preview-item">
              <MessageSquare size={12} />
              <span><strong>Tone:</strong> {formData.tone === 'Custom' ? formData.customTone : formData.tone}</span>
            </div>

            {formData.styleProfile && (
              <div className="preview-style-profile" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong>Writing Style Profile</strong>
                <NodeReaderBar
                  reader={reader}
                  placeholder="Find in profile…"
                  matchCount={reader.countMatches([formData.styleProfile, formData.rules, formData.forbidden])}
                  compact
                />
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: 'auto',
                    fontSize: reader.fontSize,
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px',
                  }}
                >
                  {reader.highlight(formData.styleProfile)}
                </div>
              </div>
            )}

            {(formData.rules || formData.forbidden) && (
              <div style={{ marginTop: 10, fontSize: reader.fontSize, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                {formData.rules && (
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Rules:</strong> {reader.highlight(formData.rules)}
                  </div>
                )}
                {formData.forbidden && (
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Forbidden:</strong> {reader.highlight(formData.forbidden)}
                  </div>
                )}
              </div>
            )}

            <div className="preview-hint" style={{ marginTop: 8 }}>
              Connect this node to an AI Assistant to apply this brand voice.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
