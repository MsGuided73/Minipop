import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import localforage from 'localforage'
import { apiFetch } from '../services/apiClient'

const CanvasContext = createContext(null)

// ─── API keys ────────────────────────────────────────────────────────────────
// Not kept here any more.
//
// They used to live in localStorage, which meant every tab could read them,
// they never followed the user to another browser, and the provider call had
// to be made from the page to use them. They now live encrypted against the
// account (pop_user_keys) and the call happens on the server, so what the
// client holds is a hint like "sk-…7Xb2" — enough to show which key is saved.

const VALID_MODELS = ['gpt-4o', 'o1-preview', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'claude-haiku-4-5-20251001']

function readModel() {
  const stored = localStorage.getItem('poppyai_model')
  return VALID_MODELS.includes(stored) ? stored : 'gpt-4o'
}

// Auto-continue: when on, any prompt that gets cut off by the model's output-token
// ceiling is automatically told to "continue" until the response actually finishes.
// On by default — the library defaults to exhaustive depth, which regularly runs
// past a single response. Turn it off in the toolbar to cap the cost of a run.
function readAutoContinue() {
  const stored = localStorage.getItem('poppyai_auto_continue')
  return stored === null ? true : stored === 'true'
}

const initialState = {
  // [{provider, label, hint, updatedAt}] — what is saved, never the keys.
  keys: [],
  keysLoaded: false,
  model: readModel(),
  autoContinue: readAutoContinue(),
  settingsOpen: false,
  boardId: localStorage.getItem('poppyai_boardId') || uuidv4(),
  boardName: localStorage.getItem('poppyai_boardName') || 'Untitled Board',
  folderId: localStorage.getItem('poppyai_folderId') || null,
  remoteBoards: [],
  folders: [],
  projects: [],
  nodes: [],
  edges: [],
}

function canvasReducer(state, action) {
  switch (action.type) {
    case 'SET_NODES':
      return { ...state, nodes: action.nodes }

    case 'SET_EDGES':
      return { ...state, edges: action.edges }

    case 'SET_KEYS':
      return { ...state, keys: action.keys, keysLoaded: true }

    case 'SET_MODEL':
      localStorage.setItem('poppyai_model', action.model)
      return { ...state, model: action.model }

    case 'SET_AUTO_CONTINUE': {
      const next = !!action.enabled
      localStorage.setItem('poppyai_auto_continue', String(next))
      return { ...state, autoContinue: next }
    }

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

    case 'SET_PROJECTS':
      return { ...state, projects: action.projects }

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

  const loadFromLocal = useCallback(async () => {
    try {
      return await localforage.getItem('poppyai_canvas')
    } catch (err) {
      console.error('LocalForage load error:', err)
      return null
    }
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

  // ─── The user's own provider keys ────────────────────────────────────────
  // Write-only from here: we send a key up and get back a hint. Nothing in
  // this app can read a stored key back out, including this function.
  const fetchKeys = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/keys')
      if (!res.ok) throw new Error('Could not read saved keys')
      dispatch({ type: 'SET_KEYS', keys: await res.json() })
    } catch (err) {
      // A server without key storage configured is a 503 here. The app still
      // works for everything that is not a model call, so this is not fatal —
      // Settings says what is wrong when the user goes looking.
      console.error('Failed to fetch keys:', err.message)
      dispatch({ type: 'SET_KEYS', keys: [] })
    }
  }, [])

  const saveKey = useCallback(async (provider, key) => {
    const res = await apiFetch(`/api/v1/keys/${provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error([body.error, body.detail].filter(Boolean).join(' '))
    await fetchKeys()
    return body
  }, [fetchKeys])

  const removeKey = useCallback(async (provider) => {
    const res = await apiFetch(`/api/v1/keys/${provider}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Could not remove your key')
    }
    await fetchKeys()
  }, [fetchKeys])

  const value = {
    state,
    dispatch,
    fetchKeys,
    saveKey,
    removeKey,
    addNode,
    updateNode,
    deleteNode,
    triggerSave,
    loadFromLocal,
    registerFlowInstance,
    saveBoardToServer: async (overrideName, overrideFolderId, overrideProjectId) => {
      const nodes = flowInstanceRef.current?.getNodes() || []
      const edges = flowInstanceRef.current?.getEdges() || []
      const payload = {
        id: state.boardId,
        name: overrideName || state.boardName,
        folderId: overrideFolderId !== undefined ? overrideFolderId : state.folderId,
        projectId: overrideProjectId !== undefined ? overrideProjectId : state.projectId,
        nodes: nodes,
        edges: edges,
        createdAt: new Date().toISOString()
      }
      const res = await apiFetch('/api/v1/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Cloud save failed')
      return await res.json()
    },
    fetchBoardsFromServer: async () => {
      const res = await apiFetch('/api/v1/boards')
      if (res.ok) {
        const boards = await res.json()
        dispatch({ type: 'SET_REMOTE_BOARDS', boards })
      }
    },
    loadBoardFromServer: async (id) => {
      // Clear persistence timer briefly so we don't accidentally save the old board while loading
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      
      const res = await apiFetch(`/api/v1/boards/${id}`)
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
    fetchProjectsFromServer: async () => {
      try {
        const res = await apiFetch('/api/v1/projects')
        if (res.ok) dispatch({ type: 'SET_PROJECTS', projects: await res.json() })
      } catch (err) {
        console.error('Failed to fetch projects:', err)
      }
    },
    createProject: async (name) => {
      const res = await apiFetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not create the project')
      }
      const project = await res.json()
      // Refresh so the new project is selectable straight away.
      const list = await apiFetch('/api/v1/projects')
      if (list.ok) dispatch({ type: 'SET_PROJECTS', projects: await list.json() })
      return project
    },

    // Folder API wrappers
    fetchFoldersFromServer: async () => {
      try {
        const res = await apiFetch('/api/v1/folders')
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
      const res = await apiFetch('/api/v1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Failed to create folder')
      return payload
    },
    deleteFolder: async (id) => {
      const res = await apiFetch(`/api/v1/folders/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete folder')
    }
  }

  // Effect to load boards and folders on mount
  React.useEffect(() => {
    value.fetchKeys()
    value.fetchBoardsFromServer()
    value.fetchProjectsFromServer()
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
