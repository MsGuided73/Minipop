import React, { useEffect, useState } from 'react'
import { LayoutGrid, Search, Map, ArrowLeftRight, Settings as SettingsIcon, Plus, Save, Check } from 'lucide-react'
import { useCanvas } from '../../context/CanvasContext'
import WorkspaceExplorer from './WorkspaceExplorer'
import './AppShell.css'

const THEME_KEY = 'contentloom_theme'
const THEMES = [
  { value: '', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'legacy-dark', label: 'Legacy Dark' },
  { value: 'legacy-light', label: 'Legacy Light' },
]

/**
 * Chrome around the canvas: topbar, icon rail, workspace explorer.
 *
 * The canvas itself is passed as children, so this component owns layout and
 * navigation only and never needs to know about React Flow.
 */
export default function AppShell({
  boards, folders, projects,
  currentBoardId, boardName,
  nodeCount = 0, edgeCount = 0,
  onOpenBoard, onRenameBoard,
  onNewCanvas, onSaveCanvas,
  isSaving = false, isDirty = false, lastSavedAt = null,
  children,
  // Rendered as a sibling of the canvas inside the flex row, so it sits to the
  // RIGHT of the canvas. Passing it as a child would nest it in the canvas
  // column and stack it underneath instead.
  rightPanel,
}) {
  const { dispatch } = useCanvas()
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) ?? '')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(boardName || '')

  // An empty value means "follow the OS", so the attribute is removed entirely
  // rather than set to a falsy string — the CSS keys off :root:not([data-theme]).
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
    else document.documentElement.removeAttribute('data-theme')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => { setDraft(boardName || '') }, [boardName])

  function commitRename() {
    setRenaming(false)
    const next = draft.trim()
    if (next && next !== boardName) onRenameBoard?.(next)
    else setDraft(boardName || '')
  }

  return (
    <div className="cl-shell">
      <header className="cl-topbar">
        <span className="cl-wordmark">ContentLoom</span>

        <span className="cl-crumb">
          Workspace /{' '}
          {renaming ? (
            <input
              className="cl-crumb-input"
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setDraft(boardName || ''); setRenaming(false) }
              }}
            />
          ) : (
            <b
              onDoubleClick={() => setRenaming(true)}
              title="Double-click to rename"
              style={{ cursor: 'text' }}
            >
              {boardName || 'Untitled Board'}
            </b>
          )}
        </span>

        <span className="cl-topbar-meta">
          {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'} · {edgeCount}{' '}
          {edgeCount === 1 ? 'connection' : 'connections'}
        </span>

        {/* Saving to the server is explicit. Local autosave keeps the canvas
            safe between saves, but only this writes it to your account. */}
        <button
          className={`cl-save-btn ${isDirty ? 'is-dirty' : ''}`}
          onClick={onSaveCanvas}
          disabled={isSaving}
          title={isDirty ? 'Unsaved changes — save to your account' : 'Save canvas'}
        >
          {isSaving ? <Save size={13} className="cl-spin" /> : isDirty ? <Save size={13} /> : <Check size={13} />}
          {isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
        </button>

        <select
          className="cl-theme-select"
          value={theme}
          onChange={e => setTheme(e.target.value)}
          aria-label="Theme"
          title="Theme"
        >
          {THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </header>

      <div className="cl-body">
        <nav className="cl-rail" aria-label="Main">
          <button
            className={`cl-rail-btn ${explorerOpen ? 'is-active' : ''}`}
            title="Workspace"
            aria-label="Toggle workspace"
            onClick={() => setExplorerOpen(o => !o)}
          >
            <LayoutGrid size={17} />
          </button>
          <button className="cl-rail-btn" title="Search (coming soon)" aria-label="Search" disabled>
            <Search size={17} />
          </button>
          <button className="cl-rail-btn" title="Canvas map (coming soon)" aria-label="Canvas map" disabled>
            <Map size={17} />
          </button>

          <span className="cl-rail-spacer" />

          <button className="cl-rail-btn" title="Import / Export (coming soon)" aria-label="Import or export" disabled>
            <ArrowLeftRight size={17} />
          </button>
          <button
            className="cl-rail-btn"
            title="Settings"
            aria-label="Settings"
            onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          >
            <SettingsIcon size={17} />
          </button>
        </nav>

        <div className={explorerOpen ? '' : 'cl-explorer-hidden'}>
          {explorerOpen && (
            <WorkspaceExplorer
              boards={boards}
              folders={folders}
              projects={projects}
              currentBoardId={currentBoardId}
              onOpenBoard={onOpenBoard}
              onNewCanvas={onNewCanvas}
            />
          )}
        </div>

        <div className="cl-canvas-region">{children}</div>

        {rightPanel}
      </div>
    </div>
  )
}
