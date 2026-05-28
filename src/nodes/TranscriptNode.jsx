import React, { useCallback, useRef, useState, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { X, FileText, Copy, Check, Download, Printer, Type as TypeIcon } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function TranscriptNode({ id, data, selected }) {
  const { deleteNode, updateNode } = useCanvas()

  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedSelection, setCopiedSelection] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const bodyRef = useRef(null)

  const transcript = data.transcript || ''
  const charCount = transcript.length
  const wordCount = transcript ? transcript.trim().split(/\s+/).length : 0
  const title = data.label || 'Transcript'

  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 12 })

  // Track text selection inside this node so the "Copy Selection" button enables correctly
  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) { setHasSelection(false); return }
      const range = sel.getRangeAt(0)
      if (bodyRef.current && bodyRef.current.contains(range.commonAncestorContainer)) {
        setHasSelection(sel.toString().trim().length > 0)
      } else {
        setHasSelection(false)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(transcript)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }, [transcript])

  const handleCopySelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString()
    if (!text.trim()) return
    navigator.clipboard.writeText(text)
    setCopiedSelection(true)
    setTimeout(() => setCopiedSelection(false), 1500)
  }, [])

  const slug = () => (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'transcript')
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  const buildMarkdown = () => {
    const lines = [`# ${title}`, '']
    if (data.videoUrl) lines.push(`- **URL:** ${data.videoUrl}`)
    if (data.uploader) lines.push(`- **Uploader:** ${data.uploader}`)
    if (data.viewCount) lines.push(`- **Views:** ${Number(data.viewCount).toLocaleString()}`)
    if (data.duration) lines.push(`- **Duration:** ${data.duration}s`)
    lines.push(`- **Words:** ${wordCount.toLocaleString()}`)
    lines.push(`- **Exported:** ${new Date().toISOString()}`)
    lines.push('', '---', '', transcript || '_(empty)_')
    return lines.join('\n')
  }

  const handleExportMd = useCallback(() => {
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug()}-${stamp()}.md`
    a.click()
    URL.revokeObjectURL(url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, title, data])

  // PDF export via browser print — opens a clean window pre-formatted for "Save as PDF"
  const handleExportPdf = useCallback(() => {
    const safe = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=900')
    if (!win) { alert('Popup blocked. Allow popups for this site to export PDF.'); return }
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${safe(title)}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1f2024; line-height: 1.65; font-size: 11pt; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22pt; margin: 0 0 8px; }
  .meta { font-size: 10pt; color: #555; margin-bottom: 18px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
  .meta div { margin-bottom: 2px; }
  .body { white-space: pre-wrap; word-wrap: break-word; }
  @media print { .no-print { display: none; } }
  .no-print { position: fixed; top: 12px; right: 12px; padding: 8px 14px; background: #e8832a; color: #fff; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; }
</style></head><body>
<button class="no-print" onclick="window.print()">Print / Save as PDF</button>
<h1>${safe(title)}</h1>
<div class="meta">
  ${data.videoUrl ? `<div><strong>URL:</strong> ${safe(data.videoUrl)}</div>` : ''}
  ${data.uploader ? `<div><strong>Uploader:</strong> ${safe(data.uploader)}</div>` : ''}
  ${data.viewCount ? `<div><strong>Views:</strong> ${Number(data.viewCount).toLocaleString()}</div>` : ''}
  <div><strong>Words:</strong> ${wordCount.toLocaleString()}</div>
  <div><strong>Exported:</strong> ${new Date().toLocaleString()}</div>
</div>
<div class="body">${safe(transcript)}</div>
<script>setTimeout(function(){ window.print(); }, 350);</script>
</body></html>`)
    win.document.close()
  }, [title, transcript, wordCount, data.videoUrl, data.uploader, data.viewCount])

  const renderBody = () => {
    if (!transcript) {
      return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No transcript text available.</p>
    }
    return <p>{reader.highlight(transcript)}</p>
  }

  return (
    <div className={`node ${selected ? 'node--selected' : ''}`} style={{ width: 460, height: 600 }}>
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      {/* Header */}
      <div className="node-header">
        <div className="node-header-left" style={{ flex: 1, minWidth: 0 }}>
          <div className="node-icon" style={{ background: 'rgba(124, 92, 252, 0.15)', color: '#a78bfa' }}>
            <FileText size={13} />
          </div>
          <div className="ai-header-info" style={{ flex: 1, minWidth: 0 }}>
            <span className="node-label truncate" title={title}>{title}</span>
            <span className="ai-node-subtitle">
              {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
            </span>
          </div>
        </div>
        <div className="node-actions">
          <button
            className="node-action-btn"
            onClick={handleCopyAll}
            title="Copy entire transcript"
          >
            {copiedAll ? <Check size={11} /> : <Copy size={11} />}
          </button>
          <button
            className="node-action-btn"
            onClick={handleCopySelection}
            disabled={!hasSelection}
            title={hasSelection ? 'Copy selected text' : 'Select text in the body first'}
            style={{ opacity: hasSelection ? 1 : 0.4 }}
          >
            {copiedSelection ? <Check size={11} /> : <TypeIcon size={11} />}
          </button>
          <button
            className="node-action-btn"
            onClick={handleExportMd}
            title="Export as Markdown (.md)"
          >
            <Download size={11} />
          </button>
          <button
            className="node-action-btn"
            onClick={handleExportPdf}
            title="Export as PDF (opens print dialog)"
          >
            <Printer size={11} />
          </button>
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Search + font controls (shared component) */}
      <NodeReaderBar
        reader={reader}
        placeholder="Find in transcript…"
        matchCount={reader.countMatches(transcript)}
      />


      {/* Body — selectable, scrollable */}
      <div
        ref={bodyRef}
        className="nopan node-scrollable"
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px',
          fontSize: reader.fontSize,
          lineHeight: 1.65,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          userSelect: 'text',
          cursor: 'text',
          background: 'var(--bg-card)',
        }}
      >
        {renderBody()}
      </div>

      {/* Footer: source link */}
      {data.videoUrl && (
        <div className="node-footer">
          <a
            href={data.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="node-meta truncate"
            style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            ↗ {data.videoUrl}
          </a>
        </div>
      )}
    </div>
  )
}
