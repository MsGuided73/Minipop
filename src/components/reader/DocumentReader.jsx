import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, X } from 'lucide-react'
import { renderMarkdown } from '../../lib/markdown'
import './DocumentReader.css'

const SIZE_MIN = -2
const SIZE_MAX = 3
const SIZE_BASE = 15.5
const SIZE_STEP = 1.5

/**
 * The reading pane. A node card stays compact on the canvas; this shows the
 * document it produced at a comfortable width, rendered rather than raw.
 *
 * It is a VIEW over the node's thread — the messages still live on the node,
 * so nothing here owns state that would need migrating. A follow-up typed at
 * the bottom posts into that same thread via onSendFollowUp.
 */
export default function DocumentReader({
  open,
  title,
  typeLabel,
  color,
  sourceLabel,
  markdown,
  busy = false,
  onClose,
  onSendFollowUp,
}) {
  const [sizeStep, setSizeStep] = useState(0)
  const [followUp, setFollowUp] = useState('')
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef(null)
  const closeRef = useRef(null)

  const html = useMemo(() => (markdown ? renderMarkdown(markdown) : ''), [markdown])

  // Reset scroll and zoom for each newly opened document, and move focus into
  // the drawer so Escape and tabbing behave for keyboard users.
  useEffect(() => {
    if (!open) return
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setSizeStep(0)
    closeRef.current?.focus()
  }, [open, markdown])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard can be blocked by permissions; the save button still works */
    }
  }

  function handleSave() {
    const blob = new Blob([markdown || ''], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || 'document').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'document'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function submitFollowUp(e) {
    e.preventDefault()
    const text = followUp.trim()
    if (!text || busy) return
    onSendFollowUp?.(text)
    setFollowUp('')
  }

  const docSize = `${SIZE_BASE + sizeStep * SIZE_STEP}px`

  return (
    <>
      <div className={`cl-backdrop ${open ? 'on' : ''}`} onClick={onClose} aria-hidden="true" />

      <aside
        className={`cl-reader ${open ? 'on' : ''}`}
        style={{ '--rc': color || 'var(--accent)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Document'}
        aria-hidden={!open}
      >
        <div className="cl-reader-head">
          <span className="cl-reader-type">
            <span className="cl-reader-dot" />
            {typeLabel || 'Document'}
          </span>
          {sourceLabel && (
            <span className="cl-reader-src" title={sourceLabel}>from “{sourceLabel}”</span>
          )}

          <div className="cl-reader-ctl">
            <button className="cl-ctl-btn" onClick={handleCopy}
              title={copied ? 'Copied' : 'Copy as markdown'} aria-label="Copy as markdown">
              {copied ? '✓' : <Copy size={13} />}
            </button>
            <button className="cl-ctl-btn" onClick={handleSave}
              title="Save .md to your drive" aria-label="Save as markdown file">
              <Download size={13} />
            </button>
            <button className="cl-ctl-btn" onClick={() => setSizeStep(s => Math.max(SIZE_MIN, s - 1))}
              title="Smaller text" aria-label="Smaller text" disabled={sizeStep <= SIZE_MIN}>A−</button>
            <button className="cl-ctl-btn" onClick={() => setSizeStep(s => Math.min(SIZE_MAX, s + 1))}
              title="Larger text" aria-label="Larger text" disabled={sizeStep >= SIZE_MAX}>A+</button>
            <button className="cl-ctl-btn" onClick={onClose} ref={closeRef}
              title="Close (Esc)" aria-label="Close reader"><X size={14} /></button>
          </div>
        </div>

        <div className="cl-reader-scroll" ref={scrollRef}>
          {html ? (
            <>
              <div
                className="cl-doc"
                style={{ '--doc-size': docSize }}
                // Safe: renderMarkdown escapes all input before emitting tags.
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <div className="cl-doc-end">· · ·</div>
            </>
          ) : (
            <p className="cl-reader-empty">
              {busy ? 'Working…' : 'This node has not produced a document yet.'}
            </p>
          )}
        </div>

        <form className="cl-reader-foot" onSubmit={submitFollowUp}>
          <input
            className="cl-followup"
            value={followUp}
            onChange={e => setFollowUp(e.target.value)}
            placeholder={busy ? 'Working…' : 'Ask a follow-up about this document…'}
            disabled={busy}
            aria-label="Ask a follow-up"
          />
          <button className="cl-send" type="submit" disabled={busy || !followUp.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      </aside>
    </>
  )
}
