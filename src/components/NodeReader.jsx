import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Type as TypeIcon } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'

// ─── Hook ───────────────────────────────────────────────────────────────────
// Shared "reader controls" for any node with substantial text:
//   - search query (with safe regex matching)
//   - font size with A− / A+ controls
//   - highlight() helper that wraps matches in <mark>
//
// Usage:
//   const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 12 })
//   <NodeReaderBar reader={reader} />
//   <div style={{ fontSize: reader.fontSize }}>{reader.highlight(text)}</div>

const FONT_MIN = 9
const FONT_MAX = 22

export function useNodeReader({ id, initialFontSize, defaultFontSize = 12, persistKey = 'fontSize' }) {
  const { updateNode } = useCanvas()

  const [search, setSearch] = useState('')
  const [fontSize, setFontSizeState] = useState(() => {
    const n = Number(initialFontSize)
    return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : defaultFontSize
  })

  // Persist size into the node's own data so it survives reloads
  useEffect(() => {
    if (id && fontSize !== initialFontSize) {
      updateNode(id, { data: { [persistKey]: fontSize } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize])

  const setFontSize = useCallback((v) => {
    const next = typeof v === 'function' ? v(fontSize) : v
    setFontSizeState(Math.max(FONT_MIN, Math.min(FONT_MAX, next)))
  }, [fontSize])

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const highlight = useCallback((text) => {
    if (text == null) return null
    const str = String(text)
    const q = search.trim()
    if (!q) return str
    const re = new RegExp(`(${escapeRegex(q)})`, 'gi')
    const parts = str.split(re)
    return parts.map((part, i) =>
      re.test(part)
        ? <mark key={i} style={{ background: 'rgba(232, 131, 42, 0.5)', color: 'inherit', padding: '0 1px', borderRadius: 2 }}>{part}</mark>
        : <React.Fragment key={i}>{part}</React.Fragment>
    )
  }, [search])

  // Count matches across an arbitrary number of text segments (for status display)
  const countMatches = useCallback((segments) => {
    const q = search.trim()
    if (!q) return 0
    const re = new RegExp(escapeRegex(q), 'gi')
    let n = 0
    for (const seg of (Array.isArray(segments) ? segments : [segments])) {
      if (seg == null) continue
      const matches = String(seg).match(re)
      if (matches) n += matches.length
    }
    return n
  }, [search])

  return useMemo(
    () => ({ search, setSearch, fontSize, setFontSize, highlight, countMatches, FONT_MIN, FONT_MAX }),
    [search, fontSize, highlight, countMatches]
  )
}

// ─── Toolbar component ──────────────────────────────────────────────────────
// Drop-in horizontal bar with search input and A−/A+ buttons.
// Pass placeholder/showMatchCount to customize; pass matchCount for the badge.

export function NodeReaderBar({ reader, placeholder = 'Find in node…', matchCount, compact = false }) {
  const { search, setSearch, setFontSize } = reader

  return (
    <div
      className="nopan node-reader-bar"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '4px 8px' : '6px 10px',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}
    >
      <Search size={11} color="var(--text-muted)" />
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 4,
          padding: '3px 6px',
          color: 'var(--text-primary)',
          fontSize: 11,
          outline: 'none',
          fontFamily: 'var(--font-sans)',
          minWidth: 0,
        }}
      />
      {search && matchCount != null && (
        <span
          style={{
            fontSize: 10,
            color: matchCount > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          title={`${matchCount} match${matchCount === 1 ? '' : 'es'}`}
        >
          {matchCount}
        </span>
      )}
      <button
        onClick={() => setFontSize(s => s - 1)}
        title="Smaller text"
        style={{
          background: 'transparent', border: '1px solid var(--border-default)',
          borderRadius: 4, color: 'var(--text-secondary)', padding: '2px 6px',
          cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-sans)',
        }}
      >A−</button>
      <button
        onClick={() => setFontSize(s => s + 1)}
        title="Larger text"
        style={{
          background: 'transparent', border: '1px solid var(--border-default)',
          borderRadius: 4, color: 'var(--text-secondary)', padding: '2px 6px',
          cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-sans)',
        }}
      >A+</button>
    </div>
  )
}
