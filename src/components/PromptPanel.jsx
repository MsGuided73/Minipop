import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Library, Search, PanelRightClose, PanelRightOpen, Play, Copy, Edit3, Trash2, X, Plus } from 'lucide-react'
import { listPrompts, deletePrompt } from '../services/promptService'
import PromptFillModal from './PromptFillModal'
import './PromptPanel.css'

const STORAGE_OPEN = 'poppyai_prompt_panel_open'
const STORAGE_WIDTH = 'poppyai_prompt_panel_width'
const MIN_WIDTH = 280
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 380

export default function PromptPanel({ onSpawnLensNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_OPEN) !== 'false')
  const [width, setWidth] = useState(() => {
    const stored = parseInt(localStorage.getItem(STORAGE_WIDTH) || '', 10)
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? Math.min(stored, MAX_WIDTH) : DEFAULT_WIDTH
  })
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [fillingPrompt, setFillingPrompt] = useState(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [error, setError] = useState('')

  // ─── Persist open/width ─────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(STORAGE_OPEN, open ? 'true' : 'false') }, [open])
  useEffect(() => { localStorage.setItem(STORAGE_WIDTH, String(width)) }, [width])

  // ─── Load prompts on mount ──────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listPrompts()
      setPrompts(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // ─── Resize drag handle ─────────────────────────────────────────────────
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
  }, [])

  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX))
      setWidth(next)
    }
    function onUp() {
      draggingRef.current = false
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ─── Derived data ───────────────────────────────────────────────────────
  const allTags = useMemo(() => {
    const set = new Set()
    prompts.forEach(p => (p.tags || []).forEach(t => set.add(t)))
    return [...set].sort()
  }, [prompts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return prompts.filter(p => {
      if (activeTag && !(p.tags || []).includes(activeTag)) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      )
    })
  }, [prompts, search, activeTag])

  const selected = prompts.find(p => p.id === selectedId) || null

  // ─── Actions ─────────────────────────────────────────────────────────────
  const handleUse = () => {
    if (!selected) return
    setFillingPrompt(selected)
  }

  const handleDelete = async () => {
    if (!selected || selected.isSeed) return
    if (!window.confirm(`Delete prompt "${selected.title}"? This cannot be undone.`)) return
    try {
      await deletePrompt(selected.id)
      setSelectedId(null)
      await refresh()
    } catch (err) {
      alert(err.message)
    }
  }

  // Render highlighted prompt body with {{var}} markers visually emphasized
  const renderBodyWithMarkers = (body) => {
    if (!body) return null
    const parts = body.split(/(\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\})/g)
    return parts.map((part, i) => {
      if (/^\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}$/.test(part)) {
        return <span key={i} className="var-marker">{part}</span>
      }
      return <React.Fragment key={i}>{part}</React.Fragment>
    })
  }

  return (
    <>
      <div
        className={`prompt-panel-container ${open ? '' : 'closed'}`}
        style={{ width: open ? width : 0 }}
      >
        {open && (
          <div
            className={`prompt-panel-resize ${dragging ? 'dragging' : ''}`}
            onMouseDown={onMouseDown}
            title="Drag to resize"
          />
        )}

        <div className="prompt-panel-header">
          <div className="prompt-panel-title">
            <Library size={14} /> Prompt Library
          </div>
          <div className="prompt-panel-header-actions">
            <button
              className="prompt-panel-icon-btn"
              onClick={() => setCreatingNew(true)}
              title="New prompt"
            >
              <Plus size={16} />
            </button>
            <button
              className="prompt-panel-icon-btn"
              onClick={() => setOpen(false)}
              title="Collapse"
            >
              <PanelRightClose size={16} />
            </button>
          </div>
        </div>

        <div className="prompt-panel-search">
          <Search size={12} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search prompts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {allTags.length > 0 && (
          <div className="prompt-panel-tags">
            {activeTag && (
              <button
                className="prompt-tag-chip active"
                onClick={() => setActiveTag(null)}
              >
                <X size={9} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                {activeTag}
              </button>
            )}
            {!activeTag && allTags.map(t => (
              <button
                key={t}
                className="prompt-tag-chip"
                onClick={() => setActiveTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="prompt-list">
          {loading && <div className="prompt-empty">Loading prompts…</div>}
          {!loading && error && (
            <div className="prompt-empty" style={{ color: 'var(--accent-danger)' }}>
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="prompt-empty">
              {prompts.length === 0
                ? 'No prompts yet. Seed prompts should load from the server.'
                : 'No prompts match your filters.'}
            </div>
          )}
          {!loading && filtered.map(p => (
            <div
              key={p.id}
              className={`prompt-card ${selectedId === p.id ? 'active' : ''}`}
              onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
            >
              <div className="prompt-card-title">
                {p.title}
                {p.isSeed && <span className="prompt-card-seed-badge">seed</span>}
              </div>
              {p.description && (
                <div className="prompt-card-desc">{p.description}</div>
              )}
              {p.tags?.length > 0 && (
                <div className="prompt-card-tags">
                  {p.tags.map(t => (
                    <span key={t} className="prompt-card-tag">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {selected && (
          <div className="prompt-detail">
            <div className="prompt-detail-header">
              <span className="prompt-detail-title">{selected.title}</span>
              <button
                className="prompt-panel-icon-btn"
                onClick={() => setSelectedId(null)}
                title="Close detail"
              >
                <X size={14} />
              </button>
            </div>
            <div className="prompt-detail-actions">
              <button
                className="primary"
                onClick={handleUse}
                title="Open variable fill modal and spawn a Lens Node"
              >
                <Play size={11} /> Use Prompt
              </button>
              <button
                onClick={() => setFillingPrompt({ ...selected, _saveAsVariation: true })}
                title="Create an editable copy as a variation"
              >
                <Copy size={11} /> Save Variation
              </button>
              <button
                onClick={handleDelete}
                disabled={selected.isSeed}
                className="danger"
                title={selected.isSeed ? 'Seed prompts cannot be deleted' : 'Delete this prompt'}
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="prompt-detail-body">
              {renderBodyWithMarkers(selected.body)}
            </div>
          </div>
        )}
      </div>

      {!open && (
        <button
          className="prompt-panel-float-open"
          onClick={() => setOpen(true)}
          title="Open Prompt Library"
        >
          <PanelRightOpen size={18} />
        </button>
      )}

      {fillingPrompt && (
        <PromptFillModal
          prompt={fillingPrompt}
          isSaveAsVariation={!!fillingPrompt._saveAsVariation}
          onClose={() => setFillingPrompt(null)}
          onSpawnLensNode={onSpawnLensNode}
          onRefreshLibrary={refresh}
        />
      )}

      {creatingNew && (
        <PromptFillModal
          prompt={{ id: null, title: '', body: '', description: '', tags: [], variables: [] }}
          isCreateNew
          onClose={() => setCreatingNew(false)}
          onSpawnLensNode={onSpawnLensNode}
          onRefreshLibrary={refresh}
        />
      )}
    </>
  )
}
