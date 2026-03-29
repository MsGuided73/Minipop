import React, { useCallback, useRef, useState, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { CanvasProvider, useCanvas } from './context/CanvasContext'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Settings from './components/Settings'
import MediaNode from './nodes/MediaNode'
import YouTubeNode from './nodes/YouTubeNode'
import TextNode from './nodes/TextNode'
import URLNode from './nodes/URLNode'
import DocumentNode from './nodes/DocumentNode'
import AIAssistantNode from './nodes/AIAssistantNode'
import AnalysisNode from './nodes/AnalysisNode'
import CrossReferenceNode from './nodes/CrossReferenceNode'
import PersonaNode from './nodes/PersonaNode'
import GroupNode from './nodes/GroupNode'
import SemanticEdge from './components/SemanticEdge'
import ImageGeneratorNode from './nodes/ImageGeneratorNode'
import VoiceAgentNode from './nodes/VoiceAgentNode'
import './App.css'

// Register node types
const NODE_TYPES = {
  mediaNode: MediaNode,
  youtubeNode: YouTubeNode,
  textNode: TextNode,
  urlNode: URLNode,
  documentNode: DocumentNode,
  aiAssistantNode: AIAssistantNode,
  analysisNode: AnalysisNode,
  crossReferenceNode: CrossReferenceNode,
  personaNode: PersonaNode,
  groupNode: GroupNode,
  imageGeneratorNode: ImageGeneratorNode,
  voiceAgentNode: VoiceAgentNode,
}

// Register edge types
const EDGE_TYPES = {
  semantic: SemanticEdge,
}

function CanvasApp() {
  const { state, dispatch, addNode, triggerSave, registerFlowInstance } = useCanvas()
  const [nodes, setNodes, onNodesChange] = useNodesState(state.nodes || [])
  const [edges, setEdges, onEdgesChange] = useEdgesState(state.edges || [])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showMiniMap, setShowMiniMap] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('contentloom-theme') || 'dark')
  const [contextMenu, setContextMenu] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('contentloom-theme', theme)
  }, [theme])

  const reactFlowWrapper = useRef(null)
  const reactFlowInstance = useRef(null)

  // ── CRITICAL: React Flow instance is now registered in onInit

  // Keep context mirror and auto-save in sync with React Flow state
  useEffect(() => {
    dispatch({ type: 'SET_NODES', nodes })
    dispatch({ type: 'SET_EDGES', edges })
    triggerSave(nodes, edges)
  }, [nodes, edges])

  // Load persisted nodes on first mount
  useEffect(() => {
    if (state.nodes?.length > 0 && nodes.length === 0) {
      setNodes(state.nodes)
      setEdges(state.edges || [])
    }
  }, [])

  // Handle new connections
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      type: 'semantic',
      animated: true,
      style: { stroke: 'rgba(124, 92, 252, 0.7)', strokeWidth: 2 },
    }, eds))
  }, [setEdges])

  // Handle right-click to open action menu
  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault()
    setContextMenu({
      id: node.id,
      top: e.clientY < window.innerHeight - 200 ? e.clientY : e.clientY - 150,
      left: e.clientX < window.innerWidth - 200 ? e.clientX : e.clientX - 150,
      node: node,
    })
  }, [])

  // Close Context Menu when clicking empty canvas pane
  const onPaneClick = useCallback(() => {
    if (contextMenu) setContextMenu(null)
  }, [contextMenu])

  // Get canvas position from screen coords
  const screenToCanvas = useCallback((screenX, screenY) => {
    if (!reactFlowInstance.current || !reactFlowWrapper.current) return { x: 0, y: 0 }
    const rect = reactFlowWrapper.current.getBoundingClientRect()
    return reactFlowInstance.current.screenToFlowPosition({
      x: screenX - rect.left,
      y: screenY - rect.top,
    })
  }, [])

  // Add a node at center or specific position
  const handleAddNode = useCallback((type, position) => {
    let pos = position
    if (!pos && reactFlowInstance.current) {
      const vp = reactFlowInstance.current.getViewport()
      const rect = reactFlowWrapper.current?.getBoundingClientRect()
      pos = reactFlowInstance.current.screenToFlowPosition({
        x: (rect?.width || 800) / 2,
        y: (rect?.height || 600) / 2,
      })
    }
    pos = pos || { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 }

    const defaults = getNodeDefaults(type)
    const id = crypto.randomUUID()
    const newNode = {
      id,
      type,
      position: pos,
      data: defaults,
      ...(type === 'groupNode' ? { style: { width: 400, height: 300, zIndex: -1 } } : {})
    }
    setNodes(nds => [...nds, newNode])
    return id
  }, [setNodes])

  // File drop handler
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setIsDraggingOver(false)

    const files = Array.from(e.dataTransfer.files)
    const text = e.dataTransfer.getData('text/plain')
    const url = e.dataTransfer.getData('text/uri-list') || text

    // Handle URL drops
    if (files.length === 0 && url) {
      const pos = screenToCanvas(e.clientX, e.clientY)
      const isYouTube = /youtube\.com|youtu\.be/.test(url)
      const type = isYouTube ? 'youtubeNode' : 'urlNode'
      const id = crypto.randomUUID()
      const newNode = {
        id,
        type,
        position: pos,
        data: {
          label: isYouTube ? 'YouTube Video' : new URL(url).hostname.replace('www.', ''),
          url,
          extractedText: `URL: ${url}`,
        },
      }
      setNodes(nds => [...nds, newNode])
      return
    }

    // Handle file drops — place in a grid if multiple
    const cols = Math.ceil(Math.sqrt(files.length))
    const spacing = { x: 320, y: 240 }
    const basePos = screenToCanvas(e.clientX, e.clientY)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const col = i % cols
      const row = Math.floor(i / cols)
      const pos = {
        x: basePos.x + col * spacing.x,
        y: basePos.y + row * spacing.y,
      }

      await processFile(file, pos, setNodes)
    }
  }, [screenToCanvas, setNodes])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    if (!reactFlowWrapper.current?.contains(e.relatedTarget)) {
      setIsDraggingOver(false)
    }
  }, [])

  // Paste handler for URLs
  useEffect(() => {
    const handlePaste = async (e) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text) return

      const isURL = /^https?:\/\//.test(text.trim())
      if (!isURL) return

      const center = reactFlowInstance.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) || { x: 200, y: 200 }

      const isYouTube = /youtube\.com|youtu\.be/.test(text)
      const id = crypto.randomUUID()
      const newNode = {
        id,
        type: isYouTube ? 'youtubeNode' : 'urlNode',
        position: center,
        data: {
          label: isYouTube ? 'YouTube Video' : 'Web Link',
          url: text.trim(),
          extractedText: `URL: ${text.trim()}`,
        },
      }
      setNodes(nds => [...nds, newNode])
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [setNodes])

  return (
    <div className="app-root flex-row">
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      
      <div className="app-main">
        <Toolbar 
          onAddNode={(type) => handleAddNode(type)} 
          theme={theme}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        />

        {state.settingsOpen && <Settings />}

      <div
        ref={reactFlowWrapper}
        className={`canvas-wrap ${isDraggingOver ? 'canvas-drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {isDraggingOver && (
          <div className="drop-overlay">
            <div className="drop-overlay-content">
              <div className="drop-overlay-icon">📎</div>
              <p className="drop-overlay-text">Drop files or URLs onto the canvas</p>
              <p className="drop-overlay-hint">Images, videos, PDFs, documents, YouTube links…</p>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onInit={(instance) => { 
            reactFlowInstance.current = instance;
            registerFlowInstance(instance);
          }}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView={nodes.length > 0}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          snapToGrid={false}
          deleteKeyCode="Delete"
          multiSelectionKeyCode="Shift"
          connectionLineStyle={{ stroke: 'rgba(124, 92, 252, 0.7)', strokeWidth: 2 }}
          connectionLineType="bezier"
          noWheelClassName="nopan"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1.2}
            color="rgba(255,255,255,0.06)"
          />
          <Controls position="bottom-left" />
          {showMiniMap && (
            <MiniMap
              position="bottom-right"
              nodeColor={(node) => getNodeMinimapColor(node.type)}
              maskColor="rgba(10,11,15,0.8)"
              style={{ bottom: 80, right: 24 }}
            />
          )}

          {/* Minimap Toggle Button */}
          <button
            onClick={() => setShowMiniMap(!showMiniMap)}
            style={{
              position: 'absolute',
              bottom: 24,
              right: 24,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: showMiniMap ? 'var(--accent-primary)' : 'var(--bg-surface)',
              color: showMiniMap ? '#fff' : 'var(--text-primary)',
              border: `1px solid ${showMiniMap ? 'transparent' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: 500,
              transition: 'all 0.2s ease'
            }}
          >
            🗺️ {showMiniMap ? 'Hide Map' : 'Show Map'}
          </button>
        </ReactFlow>

        {/* Empty state */}
        {nodes.length === 0 && !isDraggingOver && (
          <div className="canvas-empty">
            <div className="canvas-empty-card">
              <div className="canvas-empty-emoji">🧠</div>
              <h2 className="canvas-empty-title">Your AI Canvas</h2>
              <p className="canvas-empty-desc">
                Drag & drop files here, paste URLs, or add nodes from the toolbar
              </p>
              <div className="canvas-empty-hints">
                <div className="canvas-empty-hint">
                  <span>📁</span> Drop images, videos, PDFs
                </div>
                <div className="canvas-empty-hint">
                  <span>🔗</span> Paste YouTube or web URLs
                </div>
                <div className="canvas-empty-hint">
                  <span>🤖</span> Add AI Assistant nodes to synthesize
                </div>
                <div className="canvas-empty-hint">
                  <span>↔️</span> Connect nodes with drag handles
                </div>
              </div>
              <button
                className="btn btn-primary canvas-empty-cta"
                onClick={() => handleAddNode('aiAssistantNode')}
              >
                + Add AI Assistant
              </button>
            </div>
          </div>
        )}

        {/* Node Context Menu */}
        {contextMenu && (
          <div 
            className="context-menu" 
            style={{ 
              top: contextMenu.top, 
              left: contextMenu.left, 
              position: 'absolute', 
              zIndex: 1000,
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              padding: '4px',
              minWidth: '160px',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <div 
              style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-default)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.5px' }}
            >
              {contextMenu.node.type.replace('Node', '').toUpperCase()} NODE
            </div>
            <button
              onClick={() => {
                setEdges(eds => eds.filter(e => e.source !== contextMenu.id && e.target !== contextMenu.id))
                setContextMenu(null)
              }}
              style={{ textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', fontSize: '13px' }}
              onMouseOver={(e) => e.target.style.backgroundColor = 'var(--bg-modifier-hover)'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              🔗 Unlink All
            </button>
            <button
              onClick={() => {
                setNodes(nds => nds.filter(n => n.id !== contextMenu.id))
                setEdges(eds => eds.filter(e => e.source !== contextMenu.id && e.target !== contextMenu.id))
                setContextMenu(null)
              }}
              style={{ textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', color: '#ff4d4f', cursor: 'pointer', borderRadius: '4px', marginTop: '2px', fontSize: '13px' }}
              onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(255, 77, 79, 0.1)'}
              onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              🗑️ Delete Node
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

// Process dropped files → create appropriate node
async function processFile(file, position, setNodes) {
  const id = crypto.randomUUID()
  const { type, name } = file

  // Image/Video
  if (type.startsWith('image/') || type.startsWith('video/')) {
    const preview = await readAsDataURL(file)
    const node = {
      id,
      type: 'mediaNode',
      position,
      data: {
        label: file.name,
        mimeType: type,
        size: file.size,
        preview,
        extractedText: `Media file: ${file.name} (${formatBytes(file.size)})`,
      },
    }
    setNodes(nds => [...nds, node])
    return
  }

  // Text / Markdown / CSV
  if (type.startsWith('text/') || /\.(md|csv|txt|json)$/i.test(name)) {
    const content = await readAsText(file)
    const node = {
      id,
      type: 'textNode',
      position,
      data: {
        label: file.name,
        content,
        extractedText: content,
      },
    }
    setNodes(nds => [...nds, node])
    return
  }

  // PDF and other documents
  const node = {
    id,
    type: 'documentNode',
    position,
    data: {
      label: file.name,
      mimeType: type || 'application/octet-stream',
      size: file.size,
      extractedText: `Document: ${file.name}\n(PDF text extraction requires a server-side component)`,
    },
  }
  setNodes(nds => [...nds, node])
}

function readAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsDataURL(file)
  })
}

function readAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsText(file)
  })
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getNodeDefaults(type) {
  switch (type) {
    case 'aiAssistantNode': return { label: 'AI Assistant', messages: [] }
    case 'textNode': return { label: 'Note', content: '' }
    case 'urlNode': return { label: 'Web Link', url: '' }
    case 'mediaNode': return { label: 'Media', mimeType: '' }
    case 'youtubeNode': return { label: 'YouTube', url: '' }
    case 'documentNode': return { label: 'Document' }
    case 'crossReferenceNode': return { label: 'Cross-Reference Matrix' }
    case 'imageGeneratorNode': return { label: 'Image Gen', prompt: '' }
    case 'voiceAgentNode': return { label: 'Voice Agent' }
    case 'groupNode': return { label: 'Grouping Window' }
    default: return { label: type }
  }
}



function getNodeMinimapColor(type) {
  switch (type) {
    case 'aiAssistantNode': return '#7c5cfc'
    case 'youtubeNode': return '#ff4070'
    case 'textNode': return '#4ade80'
    case 'urlNode': return '#60a5fa'
    case 'documentNode': return '#fbbf24'
    case 'crossReferenceNode': return '#ec4899'
    case 'groupNode': return '#7c5cfc'
    default: return '#a78bfa'
  }
}

export default function App() {
  return (
    <CanvasProvider>
      <ReactFlowProvider>
        <CanvasApp />
      </ReactFlowProvider>
    </CanvasProvider>
  )
}
