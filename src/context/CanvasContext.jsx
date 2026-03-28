import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import localforage from 'localforage'

const CanvasContext = createContext(null)

// ─── Secure-ish API key storage ──────────────────────────────────────────────
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

const initialState = {
  apiKey: readApiKey(),
  geminiKey: readGeminiKey(),
  model: localStorage.getItem('poppyai_model') || 'gpt-4o',
  settingsOpen: false,
  boardId: localStorage.getItem('poppyai_boardId') || uuidv4(),
  boardName: localStorage.getItem('poppyai_boardName') || 'Untitled Board',
  folderId: localStorage.getItem('poppyai_folderId') || null,
  remoteBoards: [],
  folders: [],
}

function canvasReducer(state, action) {
  switch (action.type) {
    case 'SET_API_KEY':
      saveApiKey(action.key)
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
  // We register the reactFlow instance so we can read/write nodes and edges
  // without storing them redundantly in our context memory.
  const flowInstanceRef = useRef(null)

  const registerFlowInstance = useCallback((instance) => {
    flowInstanceRef.current = instance
  }, [])

  // ─── Auto-save ─────────────────────────────────────────────────────────────
  const triggerSave = useCallback((nodes, edges) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        localforage.setItem('poppyai_canvas', { nodes, edges })
      } catch (err) {
          console.error('LocalForage save error:', err)
      }
    }, 2000)
  }, [])

  // ─── Node operations ───────────────────────────────────────────────────────

  const addNode = useCallback((type, position, data = {}) => {
    const id = uuidv4()
    const baseData = { label: data.label || type, ...data }
    const dimensions = getNodeDimensions(type)
    const node = { id, type, position, data: baseData, ...dimensions }
    if (flowInstanceRef.current?.setNodes) {
        flowInstanceRef.current.setNodes(nds => [...nds, node])
    }
    return id
  }, [])

  const updateNode = useCallback((id, updates) => {
    if (!flowInstanceRef.current?.setNodes) return
    flowInstanceRef.current.setNodes(nds =>
      nds.map(n =>
        n.id === id
          ? { ...n, ...updates, data: { ...n.data, ...(updates.data || {}) } }
          : n
      )
    )
  }, [])

  const deleteNode = useCallback((id) => {
    if (flowInstanceRef.current?.setNodes) {
        flowInstanceRef.current.setNodes(nds => nds.filter(n => n.id !== id))
    }
    if (flowInstanceRef.current?.setEdges) {
        flowInstanceRef.current.setEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
    }
  }, [])

  const value = {
    state,
    dispatch,
    addNode,
    updateNode,
    deleteNode,
    triggerSave,
    registerFlowInstance,
    saveBoardToServer: async () => {
      const nodes = flowInstanceRef.current?.getNodes() || []
      const edges = flowInstanceRef.current?.getEdges() || []
      const payload = {
        id: state.boardId,
        name: state.boardName,
        folderId: state.folderId,
        nodes: nodes,
        edges: edges,
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
        
        if (flowInstanceRef.current?.setNodes) flowInstanceRef.current.setNodes(board.nodes)
        if (flowInstanceRef.current?.setEdges) flowInstanceRef.current.setEdges(board.edges)
      }
    },
    setBoardInfo: (name, id, folderId = null) => {
      dispatch({ type: 'SET_BOARD_INFO', name, id: id || state.boardId, folderId: folderId ?? state.folderId })
    },
    clearCanvas: () => {
      if (flowInstanceRef.current?.setNodes) flowInstanceRef.current.setNodes([])
      if (flowInstanceRef.current?.setEdges) flowInstanceRef.current.setEdges([])
      localforage.removeItem('poppyai_canvas')
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
