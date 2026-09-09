// Node identity — the color and label a card wears on the canvas.
//
// The schema gives each output type its own hue so that, zoomed out, color
// alone tells you the shape of a canvas. The mockup shows four: source,
// script, guide, notes.
//
// In the real app a Lens node's kind comes from the prompt that made it, so
// identity is derived from the prompt's tags first (structured, author-set),
// then its title (free text), then a stable fallback. Tags win because a user
// can rename a prompt without meaning to change what kind of thing it makes.

export const IDENTITIES = {
  source: { key: 'source', label: 'Source', varName: '--c-source' },
  script: { key: 'script', label: 'Video Script', varName: '--c-script' },
  guide:  { key: 'guide',  label: 'How-To Guide', varName: '--c-guide' },
  notes:  { key: 'notes',  label: 'Study Notes', varName: '--c-notes' },
}

// Ordered: the first rule that matches wins, so put the specific before the general.
const RULES = [
  { key: 'script', tags: ['script', 'video', 'viral', 'social'], words: ['script', 'video', 'viral', 'reel', 'short'] },
  { key: 'guide',  tags: ['guide', 'how-to', 'course', 'education'], words: ['guide', 'how-to', 'how to', 'course', 'tutorial', 'checklist', 'action plan'] },
  { key: 'notes',  tags: ['notes', 'summary', 'extraction', 'analysis'], words: ['notes', 'summary', 'summar', 'glossary', 'faq', 'quiz', 'mind map', 'takeaway'] },
]

const SOURCE_NODE_TYPES = new Set([
  'youtubeNode', 'mediaNode', 'documentNode', 'urlNode', 'textNode', 'transcriptNode',
])

/**
 * @param {{promptTitle?: string, promptTags?: string[], nodeType?: string}} input
 * @returns {{key: string, label: string, varName: string, color: string}}
 */
export function identityFor({ promptTitle = '', promptTags = [], nodeType = '' } = {}) {
  if (SOURCE_NODE_TYPES.has(nodeType)) return withColor(IDENTITIES.source)

  const tags = promptTags.map(t => String(t).toLowerCase())
  for (const rule of RULES) {
    if (rule.tags.some(t => tags.includes(t))) return withColor(IDENTITIES[rule.key])
  }

  const title = String(promptTitle).toLowerCase()
  for (const rule of RULES) {
    if (rule.words.some(w => title.includes(w))) return withColor(IDENTITIES[rule.key])
  }

  // Anything unclassified takes the accent rather than an arbitrary hue —
  // a wrong identity is worse than a neutral one.
  return { key: 'default', label: promptTitle || 'Document', varName: '--accent', color: 'var(--accent)' }
}

function withColor(identity) {
  return { ...identity, color: `var(${identity.varName})` }
}

/** The label a card shows: the prompt's own name, falling back to the family name. */
export function displayLabel({ promptTitle, identity }) {
  return promptTitle || identity?.label || 'Document'
}
