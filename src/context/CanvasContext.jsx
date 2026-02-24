import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

const CanvasContext = createContext(null)

// ─── Secure-ish API key storage ──────────────────────────────────────────────
// Base64 obfuscation: key never stored as plain text in localStorage.
// Not cryptographically secure (client-side only) but prevents casual inspection.
function encodeKey(raw) {
  try { return btoa(unescape(encodeURIComponent(raw))) } catch { return raw }
}
function decodeKey(encoded) {
  try { return decodeURIComponent(escape(atob(encoded))) } catch { return encoded }
}
function saveApiKey(raw) {
  if (!raw) { localStorage.removeItem('poppyai_apikey'); return }
  localStorage.setItem('poppyai_apikey', encodeKey(raw))
}
function readApiKey() {
  try {
    const stored = localStorage.getItem('poppyai_apikey')
    if (!stored) return ''
    return decodeKey(stored)
  } catch { return '' }
}

// ─── Canvas state persistence ─────────────────────────────────────────────────
// Canvas only stores nodes + edges. API key & model are stored separately
// so they survive canvas clears and are never accidentally overwritten.
function loadCanvasState() {
  try {
    const saved = localStorage.getItem('poppyai_canvas')
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

const savedCanvas = loadCanvasState()
const initialState = {
  // Canvas data (from canvas save)
  nodes: savedCanvas?.nodes || [],
  edges: savedCanvas?.edges || [],
  viewport: savedCanvas?.viewport || { x: 0, y: 0, zoom: 1 },
  // Always loaded from their own keys — never wiped by canvas saves
  apiKey: readApiKey(),
  model: localStorage.getItem('poppyai_model') || 'gpt-5.2-2025-12-11',
  settingsOpen: false,
  selectedNodes: [],
}

function canvasReducer(state, action) {
  switch (action.type) {
    case 'SET_NODES':
      return { ...state, nodes: action.nodes }

    case 'SET_EDGES':
      return { ...state, edges: action.edges }

    case 'ADD_NODE':
      return { ...state, nodes: [...state.nodes, action.node] }

    case 'UPDATE_NODE':
      return {
        ...state,
        nodes: state.nodes.map(n =>
          n.id === action.id
            ? { ...n, ...action.updates, data: { ...n.data, ...(action.updates.data || {}) } }
            : n
        ),
      }

    case 'DELETE_NODE': {
      const nodeId = action.id
      return {
        ...state,
        nodes: state.nodes.filter(n => n.id !== nodeId),
        edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      }
    }

    case 'ADD_EDGE':
      return { ...state, edges: [...state.edges, action.edge] }

    case 'DELETE_EDGE':
      return { ...state, edges: state.edges.filter(e => e.id !== action.id) }

    case 'SET_VIEWPORT':
      return { ...state, viewport: action.viewport }

    case 'SET_API_KEY':
      saveApiKey(action.key)         // obfuscated base64 storage
      return { ...state, apiKey: action.key }

    case 'SET_MODEL':
      localStorage.setItem('poppyai_model', action.model)
      return { ...state, model: action.model }

    case 'TOGGLE_SETTINGS':
      return { ...state, settingsOpen: !state.settingsOpen }

    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false }

    case 'CLEAR_CANVAS':
      return { ...state, nodes: [], edges: [] }

    default:
      return state
  }
}

export function CanvasProvider({ children }) {
  const [state, dispatch] = useReducer(canvasReducer, initialState)
  const saveTimerRef = useRef(null)

  // ─── React Flow state bridge ───────────────────────────────────────────────
  // Stores React Flow's setNodes/setEdges so updateNode() can update what the
  // component actually RENDERS, not just the context mirror.
  const flowSettersRef = useRef({ setNodes: null, setEdges: null })

  const registerFlowSetters = useCallback((setNodes, setEdges) => {
    flowSettersRef.current = { setNodes, setEdges }
  }, [])

  // ─── Auto-save ─────────────────────────────────────────────────────────────
  const triggerSave = useCallback((nodes, edges) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem('poppyai_canvas', JSON.stringify({ nodes, edges }))
      } catch {}
    }, 2000)
  }, [])

  // ─── Node operations ───────────────────────────────────────────────────────

  const addNode = useCallback((type, position, data = {}) => {
    const id = uuidv4()
    const baseData = { label: data.label || type, ...data }
    const dimensions = getNodeDimensions(type)
    const node = { id, type, position, data: baseData, ...dimensions }
    dispatch({ type: 'ADD_NODE', node })
    return id
  }, [])

  /**
   * THE CRITICAL FIX:
   * updateNode now writes to BOTH:
   *  1. React Flow's setNodes → the node component re-renders immediately with new data
   *  2. Context reducer → keeps the mirror in sync for persistence
   *
   * Previously only (2) was happening, so nodes never saw their own updates,
   * and AI responses never appeared in the chat.
   */
  const updateNode = useCallback((id, updates) => {
    // 1. Update React Flow nodes — this is what the component renders from
    const { setNodes } = flowSettersRef.current
    if (setNodes) {
      setNodes(nds =>
        nds.map(n =>
          n.id === id
            ? { ...n, ...updates, data: { ...n.data, ...(updates.data || {}) } }
            : n
        )
      )
    }
    // 2. Update context mirror for persistence + AI context reads
    dispatch({ type: 'UPDATE_NODE', id, updates })
  }, [])

  const deleteNode = useCallback((id) => {
    const { setNodes, setEdges } = flowSettersRef.current
    if (setNodes) setNodes(nds => nds.filter(n => n.id !== id))
    if (setEdges) setEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
    dispatch({ type: 'DELETE_NODE', id })
  }, [])

  // ─── AI context builder ────────────────────────────────────────────────────
  /**
   * Reads the live React Flow nodes (passed in from getNodes()) to build
   * a rich, structured context string for the AI prompt.
   * Using getNodes() means we always get the LATEST data, including any
   * text the user typed that was saved via updateNode.
   */
  const buildAIContext = useCallback((aiNodeId, nodes, edges) => {
    // Bidirectional: find nodes connected in either direction
    // This handles users drawing the edge either way (YouTube→AI or AI→YouTube)
    const connectedNodeIds = edges
      .filter(e => e.source === aiNodeId || e.target === aiNodeId)
      .map(e => e.source === aiNodeId ? e.target : e.source)
      .filter(nodeId => nodeId !== aiNodeId)

    // Exclude other AI assistant nodes (context should be data nodes only)
    const sourceNodes = nodes.filter(
      n => connectedNodeIds.includes(n.id) && n.type !== 'aiAssistantNode'
    )

    if (sourceNodes.length === 0) return ''

    return sourceNodes.map(node => {
      const label = node.data.label || node.type
      let content = ''

      switch (node.type) {
        case 'textNode':
          content = node.data.content || node.data.extractedText || '(empty note)'
          break
        case 'youtubeNode':
          content = [
            `YouTube Video URL: ${node.data.url || '(no url)'}`,
            node.data.extractedText && node.data.extractedText !== `URL: ${node.data.url}`
              ? `Transcript/Content:\n${node.data.extractedText}`
              : 'No transcript extracted — summarize based on your knowledge of the URL.',
          ].filter(Boolean).join('\n')
          break
        case 'urlNode':
          content = [
            `Web URL: ${node.data.url || '(no url)'}`,
            node.data.extractedText ? `Page content/notes: ${node.data.extractedText}` : '',
          ].filter(Boolean).join('\n')
          break
        case 'mediaNode':
          content = node.data.extractedText ||
            `Media file: "${node.data.label}" (${node.data.mimeType || 'unknown type'})`
          break
        case 'documentNode':
          content = node.data.extractedText ||
            `Document: "${node.data.label}". Text extraction requires server-side processing.`
          break
        default:
          content = node.data.extractedText || node.data.content || node.data.url || '(no content)'
      }

      return `### Source: "${label}" [${node.type}]\n${content}`
    }).join('\n\n---\n\n')
  }, [])

  // ─── AI API call ───────────────────────────────────────────────────────────
  const callAI = useCallback(async (aiNodeId, userMessage, nodes, edges, apiKey, model) => {
    if (!apiKey) throw new Error('No API key set. Open ⚙️ Settings and paste your OpenAI API key.')

    const context = buildAIContext(aiNodeId, nodes, edges)

    const systemPrompt = context
      ? `You are a helpful AI research assistant on a visual canvas workspace.

The user has connected the following content sources to you. Read them carefully. For text notes, reproduce them accurately. For YouTube links, summarize the video if you recognize it. For URLs, describe the page if you know it.

=== CONNECTED SOURCES ===
${context}
=== END SOURCES ===

Answer the user's question grounded in these sources. Be specific and cite the source label.`
      : `You are a helpful AI assistant on a visual canvas. No content nodes are connected yet — answering as a general assistant.`

    const aiNode = nodes.find(n => n.id === aiNodeId)
    const history = aiNode?.data?.messages || []

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ]

    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
    const requestBody = {
      model,
      messages,
      max_completion_tokens: 2000,
      ...(isReasoningModel ? {} : { temperature: 0.7 }),
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }, [buildAIContext])

  const value = {
    state,
    dispatch,
    addNode,
    updateNode,
    deleteNode,
    callAI,
    buildAIContext,
    triggerSave,
    registerFlowSetters,
  }

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
}

export function useCanvas() {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('useCanvas must be used inside CanvasProvider')
  return ctx
}

function getNodeDimensions(type) {
  switch (type) {
    case 'mediaNode': return { width: 280, height: 200 }
    case 'youtubeNode': return { width: 320, height: 260 }
    case 'aiAssistantNode': return { width: 380, height: 480 }
    case 'textNode': return { width: 260, height: 160 }
    case 'urlNode': return { width: 300, height: 180 }
    case 'documentNode': return { width: 280, height: 200 }
    default: return { width: 260, height: 160 }
  }
}
