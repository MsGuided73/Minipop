// Reading a document from the outside.
//
// A node card is 270px wide: it can show a title, three lines of prose, and a
// count. All three have to be derived from the markdown the model returned,
// because nothing else knows what the document turned out to be.
//
// These are deliberately lossy — they exist to make a card legible, never to
// round-trip. The reader shows the real thing.

const FENCE = /^\s*```/

/** Inline markdown → plain text. Order matters: images before links. */
function stripInline(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images vanish entirely
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links keep their text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim()
}

function headingText(line) {
  const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
  return m ? { depth: m[1].length, text: stripInline(m[2].replace(/\s+#+\s*$/, '')) } : null
}

/**
 * Walk the prose lines, skipping fenced code.
 *
 * Fences are paired up rather than toggled. A model that runs out of context
 * mid-code-block leaves one unclosed fence behind, and a toggle would then
 * treat everything after it as code — blanking the card's preview and
 * reporting no sections for a document the reader shows in full.
 */
function eachLine(md, fn) {
  const lines = String(md ?? '').split(/\r?\n/)

  const fences = []
  lines.forEach((line, i) => { if (FENCE.test(line)) fences.push(i) })

  const inCode = new Set()
  for (let i = 0; i + 1 < fences.length; i += 2) {
    for (let j = fences[i]; j <= fences[i + 1]; j++) inCode.add(j)
  }
  // An unpaired trailing fence is a stray marker: drop that line, keep the rest.
  if (fences.length % 2 === 1) inCode.add(fences[fences.length - 1])

  lines.forEach((line, i) => { if (!inCode.has(i)) fn(line) })
}

/**
 * The document's own title — its first heading.
 * Null when the model went straight into prose, which is a fine answer: the
 * caller falls back to the node's label rather than inventing one.
 */
export function docTitle(md) {
  let found = null
  eachLine(md, line => {
    if (found) return
    const h = headingText(line)
    if (h && h.text) found = h.text
  })
  return found
}

/**
 * Three lines of prose for the card. Headings are dropped — the card already
 * shows a title and a type, and a preview made of section names says nothing
 * about what the document actually argues.
 */
export function previewText(md, limit = 260) {
  const parts = []
  eachLine(md, line => {
    if (headingText(line)) return
    const text = stripInline(
      line
        .replace(/^\s{0,3}>\s?/, '')                 // blockquote
        .replace(/^\s*[-*+]\s+/, '')                 // bullet
        .replace(/^\s*\d+[.)]\s+/, '')               // ordered
        .replace(/^\s*\|.*\|\s*$/, '')               // table row
        .replace(/^\s*[-*_]{3,}\s*$/, '')            // rule
    )
    if (text) parts.push(text)
  })

  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= limit) return joined

  const cut = joined.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, '')}…`
}

/**
 * The footer count. Sections when the document has real structure, words when
 * it does not — a bare "0 sections" would be a worse lie than a word count.
 */
export function docMeta(md) {
  let headings = 0
  let words = 0
  let sawTitle = false

  eachLine(md, line => {
    const h = headingText(line)
    if (h) {
      // The document's own title is not one of its sections.
      if (!sawTitle) { sawTitle = true; return }
      headings += 1
      return
    }
    const text = stripInline(line)
    if (text) words += text.split(/\s+/).filter(Boolean).length
  })

  return { sections: headings, words }
}

/** "1 source · 8 sections" — the line under a card. */
export function metaLine(md, sourceCount) {
  const { sections, words } = docMeta(md)
  const sources = `${sourceCount} source${sourceCount === 1 ? '' : 's'}`
  if (sections >= 2) return `${sources} · ${sections} sections`
  if (words > 0) return `${sources} · ${words.toLocaleString()} words`
  return sources
}

/**
 * The thread as one document for the reader.
 *
 * The node's messages stay the source of truth; this is a view over them. With
 * no follow-ups it is exactly the assistant's answer, which is the common case.
 * Once a conversation has happened, the exchanges are appended below the
 * document rather than replacing it — otherwise asking "shorten section 3"
 * would make the whole document disappear behind a three-line reply.
 */
export function threadToMarkdown(messages = []) {
  const visible = messages.filter(m => m && !m.hidden && m.content)
  const firstAssistant = visible.findIndex(m => m.role === 'assistant')
  if (firstAssistant === -1) return ''

  const doc = visible[firstAssistant].content
  const rest = visible.slice(firstAssistant + 1)
  if (rest.length === 0) return doc

  const lines = [doc, '', '---', '', '## Follow-ups', '']
  for (const m of rest) {
    lines.push(m.role === 'user' ? `#### ${m.content}` : m.content, '')
  }
  return lines.join('\n').trimEnd()
}
