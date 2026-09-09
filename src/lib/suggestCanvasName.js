// Suggest a canvas name from what is actually on it.
//
// The old flow opened a prompt pre-filled with "New Canvas", which is why so
// many boards ended up named nothing useful. A canvas almost always has a
// source node whose title says exactly what the canvas is about, so use it.
//
// Priority: the most specific source wins. A YouTube video title beats a
// document filename, which beats a raw URL, which beats a text note.

const PRIORITY = ['youtubeNode', 'transcriptNode', 'documentNode', 'urlNode', 'mediaNode', 'textNode']

const MAX = 60

export function suggestCanvasName(nodes = []) {
  if (!nodes.length) return ''

  for (const type of PRIORITY) {
    const node = nodes.find(n => n.type === type && titleOf(n))
    if (node) return clean(titleOf(node))
  }

  // No recognisable source: fall back to any node with a usable label.
  const any = nodes.find(n => titleOf(n))
  return any ? clean(titleOf(any)) : ''
}

function titleOf(node) {
  const d = node?.data || {}
  const candidate = d.title || d.label || d.name || ''
  // Node labels default to the type name ("youtubeNode"), which is not a title.
  if (!candidate || candidate === node.type) return ''
  return String(candidate)
}

function clean(raw) {
  let s = raw.trim()

  // Strip the noise creators put in video titles: leading/trailing pipes and
  // dashes with channel names, bracketed tags, and surrounding quotes.
  s = s.replace(/^["'“”]+|["'“”]+$/g, '')
  s = s.replace(/\s*[\[(](?:official|hd|4k|full|video|audio)[^\])]*[\])]\s*/gi, ' ')
  s = s.replace(/\s*[|·–—-]\s*[^|·–—-]{0,30}$/, m =>
    // only drop a trailing segment if it looks like a channel/suffix, not content
    /\b(official|channel|podcast|tv|show|hd|4k)\b/i.test(m) ? '' : m)
  s = s.replace(/\s{2,}/g, ' ').trim()

  if (s.length > MAX) s = s.slice(0, MAX).replace(/\s+\S*$/, '') + '…'
  return s
}
