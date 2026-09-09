// Minimal markdown → HTML renderer for the document reader.
//
// The design schema's rule is "render markdown everywhere a document is shown;
// raw # and ** never reach the screen". This covers what the prompt library
// actually emits: headings, bold/italic, bullet lists with one nest level,
// blockquotes, horizontal rules, and paragraphs.
//
// SECURITY: the input is model output, which is untrusted — a prompt can be
// steered into emitting a <script> tag or an onerror attribute. Everything is
// HTML-escaped BEFORE any formatting is applied, so the only tags in the
// result are ones this file emits. Never reorder that.
//
// Deliberately not a full CommonMark implementation. If tables or fenced code
// become common in outputs, swap this for a real parser plus a sanitizer
// rather than growing it further.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Escape first, then apply inline formatting to the safe string.
export function renderInline(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

const BLOCK_START = /^(#{1,4}\s|>|---|\s*[-*]\s|\s*\d+\.\s)/

export function renderMarkdown(md) {
  if (!md) return ''
  const lines = String(md).split('\n')
  let html = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*$/.test(line)) { i++; continue }

    if (/^---+\s*$/.test(line)) { html += '<hr>'; i++; continue }

    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      const level = h[1].length
      html += `<h${level}>${renderInline(h[2])}</h${level}>`
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      html += `<blockquote><p>${quote.map(renderInline).join('<br>')}</p></blockquote>`
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      html += '<ol>'
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        html += `<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`
        i++
      }
      html += '</ol>'
      continue
    }

    // Bullet list, one level of nesting
    if (/^\s*[-*]\s+/.test(line)) {
      html += '<ul>'
      let nested = false
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)/)
        const isNested = m[1].length >= 2
        if (isNested && !nested) { html += '<ul>'; nested = true }
        if (!isNested && nested) { html += '</ul>'; nested = false }
        html += `<li>${renderInline(m[2])}</li>`
        i++
      }
      if (nested) html += '</ul>'
      html += '</ul>'
      continue
    }

    const para = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    if (para.length) html += `<p>${para.map(renderInline).join(' ')}</p>`
  }

  return html
}
