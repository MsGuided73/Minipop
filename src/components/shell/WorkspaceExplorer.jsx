import React, { useMemo, useState } from 'react'
import { ChevronRight, Folder, FileText, Package } from 'lucide-react'

/**
 * The file-explorer workspace tree.
 *
 * Replaces the flat board list — at 174 boards that list was unusable. Boards
 * group two ways, and the segmented control swaps between them:
 *   Subjects — the folder a board lives in (pop_folders)
 *   Projects — a cross-cutting grouping (pop_projects), so a board can sit in
 *              one subject and one project at once
 *
 * Presentational: it receives boards/folders/projects and reports clicks.
 */
export default function WorkspaceExplorer({
  boards = [],
  folders = [],
  projects = [],
  currentBoardId,
  onOpenBoard,
}) {
  const [grouping, setGrouping] = useState('subjects')
  const [openIds, setOpenIds] = useState(() => new Set())

  const toggle = (id) =>
    setOpenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Group boards under their container, with an "Unfiled" bucket so nothing is
  // ever invisible just because it has no folder or project.
  const groups = useMemo(() => {
    const isSubjects = grouping === 'subjects'
    const containers = isSubjects ? folders : projects
    const keyOf = (b) => (isSubjects ? b.folderId : b.projectId) || null

    const byKey = new Map(containers.map(c => [c.id, { ...c, boards: [] }]))
    const unfiled = []

    for (const b of boards) {
      const bucket = byKey.get(keyOf(b))
      bucket ? bucket.boards.push(b) : unfiled.push(b)
    }

    const list = [...byKey.values()].filter(g => g.boards.length > 0)
    if (unfiled.length) list.push({ id: '__unfiled__', name: 'Unfiled', boards: unfiled })
    return list
  }, [boards, folders, projects, grouping])

  // The folder holding the open board starts expanded — otherwise you land in
  // a fully collapsed tree with no idea where you are.
  const autoOpen = useMemo(() => {
    const g = groups.find(g => g.boards.some(b => b.id === currentBoardId))
    return g?.id ?? null
  }, [groups, currentBoardId])

  const isOpen = (id) => openIds.has(id) || (id === autoOpen && !openIds.size)

  const GroupIcon = grouping === 'subjects' ? Folder : Package

  return (
    <aside className="cl-explorer" aria-label="Workspace">
      <div className="cl-explorer-head">
        <span className="cl-label">Workspace</span>
        <div className="cl-seg" role="tablist">
          <button
            role="tab"
            aria-selected={grouping === 'subjects'}
            className={grouping === 'subjects' ? 'on' : ''}
            onClick={() => setGrouping('subjects')}
          >
            Subjects
          </button>
          <button
            role="tab"
            aria-selected={grouping === 'projects'}
            className={grouping === 'projects' ? 'on' : ''}
            onClick={() => setGrouping('projects')}
          >
            Projects
          </button>
        </div>
      </div>

      <div className="cl-tree">
        {groups.length === 0 ? (
          <div className="cl-tree-empty">
            <b>No {grouping} yet</b>
            {grouping === 'projects'
              ? 'Assign a board to a project to group work that spans subjects.'
              : 'Boards you create will appear here.'}
          </div>
        ) : (
          groups.map(group => (
            <div key={group.id} className={`cl-folder ${isOpen(group.id) ? 'is-open' : ''}`}>
              <button
                className="cl-folder-row"
                onClick={() => toggle(group.id)}
                aria-expanded={isOpen(group.id)}
              >
                <ChevronRight size={9} className="cl-tw" />
                <GroupIcon size={13} style={{ flex: 'none', opacity: .85 }} />
                <span className="cl-folder-name">{group.name}</span>
                <span className="cl-count">{group.boards.length}</span>
              </button>

              <div className="cl-folder-kids">
                {group.boards.map(b => (
                  <button
                    key={b.id}
                    className={`cl-file-row ${b.id === currentBoardId ? 'is-current' : ''}`}
                    onClick={() => onOpenBoard?.(b)}
                    title={b.name}
                  >
                    <FileText size={11} className="cl-file-icon" />
                    <span className="cl-file-name">{b.name || 'Untitled Board'}</span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
