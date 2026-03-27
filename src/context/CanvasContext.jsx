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
function readGeminiKey() {
  try {
    const stored = localStorage.getItem('poppyai_gemini_key')
    if (!stored) return ''
    return decodeKey(stored)
  } catch { return '' }
}
function saveGeminiKey(raw) {
  if (!raw) { localStorage.removeItem('poppyai_gemini_key'); return }
  localStorage.setItem('poppyai_gemini_key', encodeKey(raw))
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
  geminiKey: readGeminiKey(),
  model: localStorage.getItem('poppyai_model') || 'gpt-4o',
  settingsOpen: false,
  selectedNodes: [],
  boardId: localStorage.getItem('poppyai_boardId') || uuidv4(),
  boardName: localStorage.getItem('poppyai_boardName') || 'Untitled Board',
  folderId: localStorage.getItem('poppyai_folderId') || null,
  remoteBoards: [],
  folders: [],
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

    case 'SET_GEMINI_KEY':
      saveGeminiKey(action.key)
      return { ...state, geminiKey: action.key }

    case 'SET_MODEL':
      localStorage.setItem('poppyai_model', action.model)
      return { ...state, model: action.model }

    case 'TOGGLE_SETTINGS':
      return { ...state, settingsOpen: !state.settingsOpen }

    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false }

    case 'CLEAR_CANVAS':
      return { ...state, nodes: [], edges: [] }

    case 'SET_BOARD_INFO':
      localStorage.setItem('poppyai_boardId', action.id)
      localStorage.setItem('poppyai_boardName', action.name)
      if (action.folderId) {
        localStorage.setItem('poppyai_folderId', action.folderId)
      } else {
        localStorage.removeItem('poppyai_folderId')
      }
      return { 
        ...state, 
        boardId: action.id, 
        boardName: action.name,
        folderId: action.folderId || null
      }

    case 'SET_REMOTE_BOARDS':
      return { ...state, remoteBoards: action.boards }

    case 'SET_FOLDERS':
      return { ...state, folders: action.folders }

    case 'LOAD_BOARD_STATE':
      return { 
        ...state, 
        nodes: action.board.nodes, 
        edges: action.board.edges, 
        boardId: action.board.id, 
        boardName: action.board.name,
        folderId: action.board.folderId || null
      }

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

    // 2. Persona Nodes (Brand Voice/Tone)
    const personaNodes = nodes.filter(
      n => connectedNodeIds.includes(n.id) && n.type === 'personaNode'
    )

    // 3. Source Nodes (Content)
    const sourceNodes = nodes.filter(
      n => connectedNodeIds.includes(n.id) && n.type !== 'aiAssistantNode' && n.type !== 'personaNode'
    )

    const personaContext = personaNodes.map(node => {
      const connectingEdge = edges.find(e => 
        (e.source === node.id && e.target === aiNodeId) || 
        (e.target === node.id && e.source === aiNodeId)
      )
      const edgeLabel = connectingEdge?.data?.label ? `[Role/Focus: ${connectingEdge.data.label}] ` : ''
      return edgeLabel + node.data.extractedText
    }).join('\n\n')

    const sourceContext = sourceNodes.map(node => {
      const connectingEdge = edges.find(e => 
        (e.source === node.id && e.target === aiNodeId) || 
        (e.target === node.id && e.source === aiNodeId)
      )
      const semanticLabel = connectingEdge?.data?.label ? ` (Relationship: ${connectingEdge.data.label})` : ''
      
      const label = (node.data.label || node.type) + semanticLabel
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

    return { sourceContext, personaContext }
  }, [])

  // ─── AI API call ───────────────────────────────────────────────────────────
  const callAI = useCallback(async (aiNodeId, userMessage, nodes, edges, apiKey, model, geminiKey) => {
    const isGemini = model.startsWith('gemini')
    const currentKey = isGemini ? geminiKey : apiKey

    if (!currentKey) {
      throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
    }

    const { sourceContext, personaContext } = buildAIContext(aiNodeId, nodes, edges)

    let systemPrompt = `You are a helpful AI research assistant on a visual canvas workspace.`

    if (personaContext) {
      systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nYou MUST strictly follow this persona, tone, and audience targeting in your response.`
    }

    if (sourceContext) {
      systemPrompt += `\n\n=== CONNECTED SOURCES ===\n${sourceContext}\n=== END SOURCES ===
      
IMPORTANT INSTRUCTION FOR YOUTUBE/URLS:
If a connected source is a YouTube video or Website and the transcript/text is marked as "Unavailable" or "Failed to fetch", you MUST use your Google Search tool to research the video's content, summaries, and key points. Do NOT claim the content is unavailable until you have attempted a search.

Answer the user's request heavily grounded in these connected sources (and your search results where applicable). Be highly specific and cite the source labels.

PROACTIVE GUIDANCE & ENHANCED SUGGESTIONS:
1. Act as an embedded intelligent guide. Always look to provide actionable, enhanced suggestions based strictly on the provided content.
2. Anticipate the user's broader goal. Outline how the curated content specifically supports that goal.
3. GAP ANALYSIS: If the currently connected sources seem insufficient or leave critical gaps to complete the desired task, explicitly ask the user if they can provide or connect additional specific information, links, or nodes to help you finish the job completely.`
    } else {
      systemPrompt += `\n\nNo content nodes are connected yet — answering as a general assistant.`
    }

    const aiNode = nodes.find(n => n.id === aiNodeId)
    const history = aiNode?.data?.messages || []

    if (isGemini) {
      // Gemini API (Google AI)
      const contents = [
        { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemPrompt}` }] },
        ...history.slice(-12).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        { role: 'user', parts: [{ text: userMessage }] }
      ]

      // Use v1beta for advanced features like grounding
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents,
          tools: [{ googleSearch: {} }]
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `Gemini API error: ${response.status}`)
      }

      const data = await response.json()
      return data.candidates[0]?.content?.parts[0]?.text || ''
    } else {
      // OpenAI API
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
          'Authorization': `Bearer ${currentKey}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    }
  }, [buildAIContext])

  const analyzeViralPatterns = useCallback(async (aiNodeId, nodes, edges, apiKey, model, geminiKey) => {
    const isGemini = model.startsWith('gemini')
    const currentKey = isGemini ? geminiKey : apiKey

    if (!currentKey) {
      throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
    }

    const { sourceContext, personaContext } = buildAIContext(aiNodeId, nodes, edges)
    if (!sourceContext && !personaContext) throw new Error('No sources or personas connected for analysis.')

    let systemPrompt = `You are a Content Intelligence Specialist. 
Your task is to perform a structured Viral Pattern Analysis on the provided source materials.`

    if (personaContext) {
      systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nYou MUST strictly analyze the materials through the lens of this persona and its target audience.`
    }

    if (sourceContext) {
      systemPrompt += `\n\n=== SOURCE MATERIALS ===\n${sourceContext}\n=== END SOURCES ===
      
IMPORTANT INSTRUCTION:
If a YouTube video or URL source is missing a transcript or text (e.g. marked as "Failed to fetch"), you MUST use your Google Search tool to research the video title, creator, and content to extract these patterns.`
    }

    systemPrompt += `\n\nAnalyze the materials for:
1. Hook Formula: How does it grab attention in the first 5-15 seconds?
2. Retention Structure: How is pacing and tension maintained?
3. Emotional Triggers: What emotions (awe, humor, fear, curiosity) are leveraged?
4. Pacing & Momentum: Narrative arc and speed.
5. CTA Placement: How and when is the audience prompted to act?

- Frame findings as "observed patterns" and "likely drivers".
- Avoid definitive certainty; use hypothesis-driven language.
- Mention the source label for each insight.`

    if (isGemini) {
      const contents = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: 'Perform a comprehensive viral pattern analysis across these sources.' }] }
      ]

      // Use v1beta for advanced features like grounding
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents, 
          generationConfig: { temperature: 0.4 },
          tools: [{ googleSearch: {} }]
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `Gemini API error: ${response.status}`)
      }

      const data = await response.json()
      return data.candidates[0]?.content?.parts[0]?.text || ''
    } else {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Perform a comprehensive viral pattern analysis across these sources.' },
      ]

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.4,
          max_completion_tokens: 2500,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    }
  }, [buildAIContext])

  const generateImage = useCallback(async (prompt, apiKey, model, geminiKey) => {
    const isGemini = model.startsWith('gemini') || model.startsWith('nano')
    const currentKey = isGemini ? geminiKey : apiKey

    if (!currentKey) {
      throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
    }

    if (isGemini) {
      // Google Nano Banana 2 (gemini-3.1-flash-image) -> Maps to v1beta predictive endpoint for images
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:predict?key=${currentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1 }
        })
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `Nano Banana 2 error: ${response.status}`)
      }

      const data = await response.json()
      // Fallback object depth checking based on standard google predictions
      const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded || data.predictions?.[0]?.b64_json
      if (!b64) throw new Error("No image data returned from Nano Banana 2")
      return `data:image/png;base64,${b64}`
    } else {
      // OpenAI Image API (gpt-image-1)
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size: "1024x1024",
          response_format: "b64_json"
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `OpenAI Image error: ${response.status}`)
      }

      const data = await response.json()
      const b64 = data.data?.[0]?.b64_json
      if (!b64) throw new Error("No image data returned from OpenAI")
      return `data:image/png;base64,${b64}`
    }
  }, [])

  const value = {
    state,
    dispatch,
    addNode,
    updateNode,
    deleteNode,
    callAI,
    analyzeViralPatterns,
    generateImage,
    buildAIContext,
    triggerSave,
    registerFlowSetters,
    saveBoardToServer: async () => {
      const payload = {
        id: state.boardId,
        name: state.boardName,
        folderId: state.folderId,
        nodes: state.nodes,
        edges: state.edges,
        createdAt: new Date().toISOString()
      }
      const res = await fetch('/api/v1/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Cloud save failed')
      return await res.json()
    },
    fetchBoardsFromServer: async () => {
      const res = await fetch('/api/v1/boards')
      if (res.ok) {
        const boards = await res.json()
        dispatch({ type: 'SET_REMOTE_BOARDS', boards })
      }
    },
    loadBoardFromServer: async (id) => {
      // Clear persistence timer briefly so we don't accidentally save the old board while loading
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      
      const res = await fetch(`/api/v1/boards/${id}`)
      if (res.ok) {
        const board = await res.json()
        dispatch({ type: 'LOAD_BOARD_STATE', board })
        localStorage.setItem('poppyai_boardId', board.id)
        localStorage.setItem('poppyai_boardName', board.name)
        if (board.folderId) localStorage.setItem('poppyai_folderId', board.folderId)
        else localStorage.removeItem('poppyai_folderId')
        
        // Also update React Flow if setters are registered
        if (flowSettersRef.current.setNodes) flowSettersRef.current.setNodes(board.nodes)
        if (flowSettersRef.current.setEdges) flowSettersRef.current.setEdges(board.edges)
      }
    },
    setBoardInfo: (name, id, folderId = null) => {
      dispatch({ type: 'SET_BOARD_INFO', name, id: id || state.boardId, folderId: folderId ?? state.folderId })
    },
    clearCanvas: () => {
      dispatch({ type: 'CLEAR_CANVAS' })
      if (flowSettersRef.current.setNodes) flowSettersRef.current.setNodes([])
      if (flowSettersRef.current.setEdges) flowSettersRef.current.setEdges([])
    },
    // Folder API wrappers
    fetchFoldersFromServer: async () => {
      try {
        const res = await fetch('/api/v1/folders')
        if (res.ok) {
          const folders = await res.json()
          dispatch({ type: 'SET_FOLDERS', folders })
        }
      } catch (err) {
        console.error('Failed to fetch folders:', err)
      }
    },
    createFolder: async (name, parentId = null) => {
      const payload = {
        id: uuidv4(),
        name,
        parentId,
        createdAt: new Date().toISOString()
      }
      const res = await fetch('/api/v1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Failed to create folder')
      return payload
    },
    deleteFolder: async (id) => {
      const res = await fetch(`/api/v1/folders/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete folder')
    }
  }

  // Effect to load boards and folders on mount
  React.useEffect(() => {
    value.fetchBoardsFromServer()
    value.fetchFoldersFromServer()
  }, [])

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
    case 'imageGeneratorNode': return { width: 300, height: 320 }
    default: return { width: 260, height: 160 }
  }
}
