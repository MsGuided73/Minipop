import React, { useState } from 'react'
import { Bot, Type, Globe, Image, Youtube, FileText, Trash2, Settings, Download, Upload, Plus, ChevronDown, Zap, UserSquare, Sun, Moon, Wand2, Mic, GitCompare, Layers, Eye } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './Toolbar.css'

const nodeTypes = [
  { type: 'aiAssistantNode', label: 'AI Assistant', icon: Bot, color: '#7c5cfc', desc: 'Chat + synthesize' },
  { type: 'groupNode', label: 'Grouping Window', icon: Layers, color: '#7c5cfc', desc: 'Spatial Context Group' },
  { type: 'textNode', label: 'Text Note', icon: Type, color: '#4ade80', desc: 'Add text/notes' },
  { type: 'urlNode', label: 'Web Link', icon: Globe, color: '#60a5fa', desc: 'Link any URL' },
  { type: 'mediaNode', label: 'Media', icon: Image, color: '#a78bfa', desc: 'Image or video' },
  { type: 'youtubeNode', label: 'YouTube', icon: Youtube, color: '#ff4070', desc: 'YouTube video' },
  { type: 'analysisNode', label: 'Analysis', icon: Zap, color: '#fbbf24', desc: 'Extract viral patterns' },
  { type: 'personaNode', label: 'Persona', icon: UserSquare, color: '#ff6b6b', desc: 'Brand voice & tone' },
  { type: 'crossReferenceNode', label: 'Cross-Reference', icon: GitCompare, color: '#ec4899', desc: 'Find contradictions & gaps' },
  { type: 'lensNode', label: 'Lens', icon: Eye, color: '#e8832a', desc: 'Apply a library prompt' },
  { type: 'imageGeneratorNode', label: 'Image Gen', icon: Wand2, color: '#ff8aeb', desc: 'Nano Banana 2 / GPT-img' },
  { type: 'voiceAgentNode', label: 'Voice Agent', icon: Mic, color: '#fb923c', desc: 'Live Gemini Voice Call' },
]

export default function Toolbar({ onAddNode, theme, onToggleTheme }) {
  const { state, dispatch } = useCanvas()
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const handleExport = () => {
    const data = JSON.stringify({ nodes: state.nodes, edges: state.edges }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'contentloom-canvas.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result)
          if (data.nodes) dispatch({ type: 'SET_NODES', nodes: data.nodes })
          if (data.edges) dispatch({ type: 'SET_EDGES', edges: data.edges })
        } catch {
          alert('Invalid canvas file')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <div className="toolbar">
      {/* Logo */}
      <div className="toolbar-logo">
        <div className="toolbar-logo-icon">
          <Bot size={16} />
        </div>
        <span className="toolbar-logo-text">ContentLoom</span>
      </div>

      <div className="toolbar-divider" />

      {/* Add Node */}
      <div className="toolbar-add-wrap">
        <button
          className="btn btn-primary toolbar-add-btn"
          onClick={() => setAddMenuOpen(!addMenuOpen)}
          id="toolbar-add-node"
        >
          <Plus size={14} />
          Add Node
          <ChevronDown size={12} className={addMenuOpen ? 'rotated' : ''} />
        </button>

        {addMenuOpen && (
          <div className="toolbar-add-menu animate-scale-in">
            {nodeTypes.map(({ type, label, icon: Icon, color, desc }) => (
              <button
                key={type}
                className="toolbar-add-item"
                onClick={() => {
                  onAddNode(type)
                  setAddMenuOpen(false)
                }}
              >
                <div className="toolbar-add-item-icon" style={{ background: `${color}20`, color }}>
                  <Icon size={14} />
                </div>
                <div className="toolbar-add-item-info">
                  <span className="toolbar-add-item-label">{label}</span>
                  <span className="toolbar-add-item-desc">{desc}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="toolbar-spacer" />

      {/* Node count */}
      <div className="toolbar-stats">
        <span className="toolbar-stat">
          <span className="toolbar-stat-num">{(state.nodes || []).length}</span> nodes
        </span>
        <span className="toolbar-stat-sep">·</span>
        <span className="toolbar-stat">
          <span className="toolbar-stat-num">{(state.edges || []).length}</span> connections
        </span>
      </div>

      <div className="toolbar-divider" />

      {/* Actions */}
      <div className="toolbar-actions">
        <button 
          className="btn-icon" 
          onClick={onToggleTheme} 
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="btn-icon" onClick={handleImport} title="Import canvas">
          <Upload size={15} />
        </button>
        <button className="btn-icon" onClick={handleExport} title="Export canvas">
          <Download size={15} />
        </button>
        <button
          className="btn-icon"
          onClick={() => {
            if ((state.nodes || []).length > 0 && !window.confirm('Clear all nodes?')) return
            dispatch({ type: 'CLEAR_CANVAS' })
          }}
          title="Clear canvas"
        >
          <Trash2 size={15} />
        </button>
        <button
          className="btn-icon"
          onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          title="Settings"
          id="toolbar-settings"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  )
}
