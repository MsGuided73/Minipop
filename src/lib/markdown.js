// Markdown → HTML for the document reader.
//
// The design rule is "render markdown everywhere a document is shown; raw # and
// ** never reach the screen". The reader is styled as a document, so anything
// this renderer does not understand shows up as literal punctuation in the
// middle of otherwise clean prose — which is exactly what a reader is for
// avoiding. It therefore covers what the prompt library actually emits:
// headings, emphasis, links, images, lists (nested, ordered, task), tables,
// fenced code, blockquotes, rules and paragraphs.
//
// SECURITY: the input is model output, which is untrusted — a prompt can be
// steered into emitting a <script> tag or an onerror attribute. Everything is
// HTML-escaped BEFORE any formatting is applied, so the only tags in the result
// are ones this file emits, and the only attributes are ones it writes itself.
// Never reorder that. This is why there is no sanitizer here and no need of
// one: nothing from the input is ever interpolated as markup.
//
// URLs are the one place input reaches an attribute, so they go through
// safeUrl() — escaping alone would not stop `javascript:`.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Allow http(s), mailto, and relative/anchor links. Everything else — most of
 * all `javascript:` — comes back null and the caller falls back to plain text.
 *
 * The scheme is tested against a copy stripped of spaces and control
 * characters, because browsers ignore those when resolving a URL: `java\tscript:`
 * still runs as script, so it must not read as a relative path here.
 */
function safeUrl(raw, imagesOnly = false) {
  const url = String(raw).trim()
  const probe = url.replace(/[\u0000-\u0020]+/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe)
  if (!scheme) return url
  const allowed = imagesOnly ? /^https?$/i : /^(?:https?|mailto)$/i
  return allowed.test(scheme[1]) ? url : null
}

// Escape first, then apply inline formatting to the safe string.
export function renderInline(s) {
  const codeSpans = []

  // Code spans are lifted out before anything else so that ** and _ inside
  // them are shown as typed rather than turned into markup.
  let out = escapeHtml(s).replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code)
    return `\u0000${codeSpans.length - 1}\u0000`
  })

  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const url = safeUrl(src, true)
      return url ? `<img src="${url}" alt="${alt}" loading="lazy">` : alt
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      const url = safeUrl(href)
      return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Single-underscore italics are deliberately unsupported: snake_case_names
    // are far more common in these documents than _emphasis_.
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`)
}

const FENCE = /^\s*(?:```|~~~)\s*([\w-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?/
const TASK = /^\[([ xX])\]\s+(.*)$/

function isBlockStart(line, lines, i) {
  return HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line) ||
    QUOTE.test(line) || FENCE.test(line) || !!tableAt(lines, i)
}

// ── tables ──────────────────────────────────────────────────────────────────

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(-1) === '|' ? s.slice(0, -1) : s
  return s.split('|').map(c => c.trim())
}

/** A table is a header row followed by a |---|:--:| delimiter row. */
function tableAt(lines, i) {
  const header = lines[i]
  const delim = lines[i + 1]
  if (!header || !delim) return null
  if (!header.includes('|') || !delim.includes('|') || !delim.includes('-')) return null
  if (!/^[\s|:-]+$/.test(delim)) return null

  const aligns = splitRow(delim).map(cell => {
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
  })
  if (aligns.some(a => a === null)) return null

  return { cells: splitRow(header), aligns }
}

function renderTable(lines, start) {
  const { cells: headers, aligns } = tableAt(lines, start)
  const cell = (tag, text, align) =>
    `<${tag}${align ? ` style="text-align:${align}"` : ''}>${renderInline(text)}</${tag}>`

  let html = '<table><thead><tr>'
  headers.forEach((h, c) => { html += cell('th', h, aligns[c]) })
  html += '</tr></thead><tbody>'

  let i = start + 2
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || !line.includes('|')) break
    const row = splitRow(line)
    html += '<tr>'
    // Pad or trim to the header width so a ragged row cannot break the table.
    for (let c = 0; c < headers.length; c++) html += cell('td', row[c] ?? '', aligns[c])
    html += '</tr>'
  }
  return [`${html}</tbody></table>`, i]
}

// ── lists ───────────────────────────────────────────────────────────────────

/**
 * Lists nest by indentation, to any depth. The previous version emitted a
 * nested <ul> as a *sibling* of <li> rather than a child, which is invalid and
 * indents inconsistently across browsers.
 */
function renderList(lines, start) {
  const first = LIST_ITEM.exec(lines[start])
  const baseIndent = first[1].length
  const ordered = /\d/.test(first[2])
  const tag = ordered ? 'ol' : 'ul'

  let html = `<${tag}>`
  let i = start

  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i])
    if (!m) break

    const indent = m[1].length
    if (indent < baseIndent) break

    if (indent > baseIndent) {
      const [nested, next] = renderList(lines, i)
      // Fold the sublist into the item it belongs to.
      html = html.replace(/<\/li>$/, `${nested}</li>`)
      i = next
      continue
    }

    if (/\d/.test(m[2]) !== ordered) break

    const task = TASK.exec(m[3])
    if (task) {
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : ''
      html += `<li class="cl-task"><input type="checkbox" disabled${checked}>${renderInline(task[2])}</li>`
    } else {
      html += `<li>${renderInline(m[3])}</li>`
    }
    i++
  }

  return [`${html}</${tag}>`, i]
}

// ── document ────────────────────────────────────────────────────────────────

export function renderMarkdown(md) {
  if (!md) return ''
  const lines = String(md).split(/\r?\n/)
  let html = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*$/.test(line)) { i++; continue }

    const fence = FENCE.exec(line)
    if (fence) {
      const lang = fence[1]
      const body = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) { body.push(lines[i]); i++ }
      i++  // closing fence (or end of input, when the model was cut off)
      html += `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`
      continue
    }

    const table = tableAt(lines, i)
    if (table) {
      const [rendered, next] = renderTable(lines, i)
      html += rendered
      i = next
      continue
    }

    if (RULE.test(line)) { html += '<hr>'; i++; continue }

    const h = HEADING.exec(line)
    if (h) {
      const level = h[1].length
      html += `<h${level}>${renderInline(h[2].replace(/\s+#+\s*$/, ''))}</h${level}>`
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const quote = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quote.push(lines[i].replace(QUOTE, ''))
        i++
      }
      html += `<blockquote><p>${quote.map(renderInline).join('<br>')}</p></blockquote>`
      continue
    }

    if (LIST_ITEM.test(line)) {
      const [rendered, next] = renderList(lines, i)
      html += rendered
      i = next
      continue
    }

    const para = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i], lines, i)) {
      para.push(lines[i])
      i++
    }
    if (para.length) html += `<p>${para.map(renderInline).join(' ')}</p>`
    else i++  // a line that starts a block but matched nothing above: never stall
  }

  return html
}
