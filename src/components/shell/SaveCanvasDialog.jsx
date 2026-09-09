import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Save, X, FolderPlus } from 'lucide-react'
import './SaveCanvasDialog.css'

const NEW_PROJECT = '__new__'

/**
 * Save dialog: name the canvas, and file it under a Subject and/or Project.
 *
 * Replaces a window.prompt that offered a name only. Filing at save time is
 * deliberate — it is the one moment the user is already thinking about what
 * this canvas *is*, and it is why 174 boards ended up unfiled.
 */
export default function SaveCanvasDialog({
  open,
  suggestedName = '',
  currentName = '',
  folders = [],
  projects = [],
  currentFolderId = null,
  currentProjectId = null,
  isSaving = false,
  onCancel,
  onSave,          // ({ name, folderId, projectId, newProjectName })
}) {
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [error, setError] = useState('')
  const nameRef = useRef(null)
  const newProjectRef = useRef(null)

  // Reset every time the dialog opens so a previous attempt never leaks in.
  useEffect(() => {
    if (!open) return
    setName(currentName && !isPlaceholder(currentName) ? currentName : suggestedName)
    setFolderId(currentFolderId || '')
    setProjectId(currentProjectId || '')
    setNewProjectName('')
    setError('')
    // Select the whole name so typing replaces the suggestion in one keystroke.
    requestAnimationFrame(() => nameRef.current?.select())
  }, [open, suggestedName, currentName, currentFolderId, currentProjectId])

  useEffect(() => {
    if (projectId === NEW_PROJECT) requestAnimationFrame(() => newProjectRef.current?.focus())
  }, [projectId])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  const creatingProject = projectId === NEW_PROJECT
  const canSave = useMemo(() => {
    if (!name.trim()) return false
    if (creatingProject && !newProjectName.trim()) return false
    return !isSaving
  }, [name, creatingProject, newProjectName, isSaving])

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Give this canvas a name.')
    if (creatingProject && !newProjectName.trim()) return setError('Name the new project, or pick an existing one.')
    setError('')
    onSave({
      name: name.trim(),
      folderId: folderId || null,
      projectId: creatingProject ? null : (projectId || null),
      newProjectName: creatingProject ? newProjectName.trim() : null,
    })
  }

  if (!open) return null

  return (
    <div className="cl-dialog-backdrop" onClick={onCancel}>
      <form
        className="cl-dialog"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Save canvas"
      >
        <div className="cl-dialog-head">
          <Save size={14} className="cl-dialog-icon" />
          <h2 className="cl-dialog-title">Save canvas</h2>
          <button type="button" className="cl-dialog-close" onClick={onCancel} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="cl-dialog-body">
          <label className="cl-field-label" htmlFor="cl-canvas-name">Name</label>
          <input
            id="cl-canvas-name"
            ref={nameRef}
            className="cl-field"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="What is this canvas about?"
            autoFocus
          />
          {suggestedName && name !== suggestedName && (
            <button
              type="button"
              className="cl-suggest"
              onClick={() => { setName(suggestedName); nameRef.current?.select() }}
            >
              Use suggestion: “{suggestedName}”
            </button>
          )}

          <label className="cl-field-label" htmlFor="cl-canvas-subject">Subject</label>
          <select
            id="cl-canvas-subject"
            className="cl-field"
            value={folderId}
            onChange={e => setFolderId(e.target.value)}
          >
            <option value="">No subject</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          <label className="cl-field-label" htmlFor="cl-canvas-project">Project</label>
          <select
            id="cl-canvas-project"
            className="cl-field"
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
          >
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={NEW_PROJECT}>+ Create a new project…</option>
          </select>

          {creatingProject && (
            <div className="cl-new-project">
              <FolderPlus size={13} />
              <input
                ref={newProjectRef}
                className="cl-field cl-field--inline"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                placeholder="New project name"
                aria-label="New project name"
              />
            </div>
          )}

          <p className="cl-dialog-hint">
            A canvas can sit in one subject and one project at the same time. Both are optional.
          </p>

          {error && <p className="cl-dialog-error">{error}</p>}
        </div>

        <div className="cl-dialog-foot">
          <button type="button" className="cl-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="cl-btn-primary" disabled={!canSave}>
            {isSaving ? 'Saving…' : 'Save canvas'}
          </button>
        </div>
      </form>
    </div>
  )
}

function isPlaceholder(n) {
  return n === 'Untitled Board' || n === 'Untitled Canvas'
}
