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
import PersonaNode from './nodes/PersonaNode'
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
  personaNode: PersonaNode,
}

function CanvasApp() {
  const { state, dispatch, addNode, triggerSave, registerFlowSetters } = useCanvas()
  const [nodes, setNodes, onNodesChange] = useNodesState(state.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(state.edges)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const reactFlowWrapper = useRef(null)
  const reactFlowInstance = useRef(null)

  // ── CRITICAL: Give the context direct access to React Flow's setNodes/setEdges
  // This is what allows updateNode() to make the AI response actually render.
  useEffect(() => {
    registerFlowSetters(setNodes, setEdges)
  }, [setNodes, setEdges, registerFlowSetters])

  // Keep context mirror and auto-save in sync with React Flow state
  useEffect(() => {
    dispatch({ type: 'SET_NODES', nodes })
    dispatch({ type: 'SET_EDGES', edges })
    triggerSave(nodes, edges)
  }, [nodes, edges])

  // Load persisted nodes on first mount
  useEffect(() => {
    if (state.nodes.length > 0 && nodes.length === 0) {
      setNodes(state.nodes)
      setEdges(state.edges)
    }
  }, [])

  // Handle new connections
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      animated: true,
      style: { stroke: 'rgba(124, 92, 252, 0.7)', strokeWidth: 2 },
    }, eds))
  }, [setEdges])

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
        <Toolbar onAddNode={(type) => handleAddNode(type)} />

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
          onInit={(instance) => { reactFlowInstance.current = instance }}
          nodeTypes={NODE_TYPES}
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
          <Controls position="bottom-right" />
          <MiniMap
            position="bottom-left"
            nodeColor={(node) => getNodeMinimapColor(node.type)}
            maskColor="rgba(10,11,15,0.8)"
            style={{ bottom: 80 }}
          />
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
