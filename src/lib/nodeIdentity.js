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
//
// The family fixes the colour and the tag, not the name. Several prompts share
// a hue — "Comprehensive Course Builder" and "Action Plan & Checklist" are both
// guides — and labelling all of them "How-To Guide" hides the difference that
// matters on the canvas. So a card leads with a badge-sized version of the
// prompt's own title and carries the family under it as a tag, which is also
// what the border colour means.

export const IDENTITIES = {
  source: { key: 'source', label: 'Source', varName: '--c-source' },
  script: { key: 'script', label: 'Video Script', varName: '--c-script' },
  guide:  { key: 'guide',  label: 'How-To Guide', varName: '--c-guide' },
  notes:  { key: 'notes',  label: 'Study Notes', varName: '--c-notes' },
}

// Ordered: the first rule that matches wins, so put the specific before the general.
const RULES = [
  { key: 'script', tags: ['script', 'video', 'viral', 'social'], words: ['script', 'video', 'viral', 'reel', 'short'] },
  // 'education' is deliberately absent: it is a subject, not a shape, and the
  // seeds hang it on quizzes, glossaries and study notes as well as courses,
  // which used to drag all of them into the guide hue.
  { key: 'guide',  tags: ['guide', 'how-to', 'course'], words: ['guide', 'how-to', 'how to', 'course', 'tutorial', 'checklist', 'action plan'] },
  { key: 'notes',  tags: ['notes', 'summary', 'extraction', 'analysis'], words: ['notes', 'summary', 'summar', 'glossary', 'faq', 'quiz', 'mind map', 'takeaway'] },
]

const SOURCE_NODE_TYPES = new Set([
  'youtubeNode', 'mediaNode', 'documentNode', 'urlNode', 'textNode', 'transcriptNode',
])

/**
 * @param {{promptTitle?: string, promptTags?: string[], nodeType?: string}} input
 * @returns {{key: string, label: string, family: string|null, varName: string, color: string}}
 *   label is what the card leads with; family is the tag under it, and is null
 *   when nothing classified the prompt — an invented tag is worse than none.
 */
export function identityFor({ promptTitle = '', promptTags = [], nodeType = '' } = {}) {
  // A source carries no prompt, so its family name is the only name it has.
  if (SOURCE_NODE_TYPES.has(nodeType)) return withColor(IDENTITIES.source)

  const name = shortLabel(promptTitle)

  const tags = promptTags.map(t => String(t).toLowerCase())
  for (const rule of RULES) {
    if (rule.tags.some(t => tags.includes(t))) return withColor(IDENTITIES[rule.key], name)
  }

  const title = String(promptTitle).toLowerCase()
  for (const rule of RULES) {
    if (rule.words.some(w => title.includes(w))) return withColor(IDENTITIES[rule.key], name)
  }

  // Anything unclassified takes the accent rather than an arbitrary hue —
  // a wrong identity is worse than a neutral one.
  return {
    key: 'default', label: name || 'Document', family: null,
    varName: '--accent', color: 'var(--accent)',
  }
}

function withColor(identity, label) {
  return {
    ...identity,
    label: label || identity.label,
    family: identity.label,
    color: `var(${identity.varName})`,
  }
}

// Leading/trailing separators are punctuation, not part of a name.
const trimEdges = (s) => s.replace(/^[\s,&/|-]+/, '').replace(/[\s,&/|+-]+$/, '')

// The badge is one short uppercase line on a 270px card header, so a name much
// past this runs into the status pill and gets clipped mid-word by the CSS.
const MAX_LABEL = 20

/**
 * A badge-sized version of a prompt title: whole words, trimmed at a natural
 * break, so "Executive Summary & Takeaways" reads as "Executive Summary"
 * rather than as a sentence cut off by an ellipsis.
 * @param {string} promptTitle
 * @param {number} [max]
 * @returns {string}
 */
export function shortLabel(promptTitle = '', max = MAX_LABEL) {
  const title = trimEdges(String(promptTitle))
  if (!title) return ''

  // Anything after a colon or dash is a subtitle restating the head, and the
  // head on its own is what the author would say out loud.
  const head = trimEdges(title.split(/\s*[:—–|(]\s*/)[0])
  const base = head.length >= 3 ? head : title
  if (base.length <= max) return base

  // Otherwise keep whole words while they fit, then drop the conjunction or
  // comma the cut left dangling.
  const words = base.split(/\s+/)
  let kept = ''
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word
    if (next.length > max) break
    kept = next
  }
  kept = trimEdges(kept)

  // One word is rarely a name — "Concept" for "Concept Explainer" says less
  // than the overflow costs — so a two-word title stays two words and lets the
  // header ellipsis take the last few pixels.
  if (words.length > 1 && !kept.includes(' ') && words[0].length <= max) {
    return trimEdges(`${words[0]} ${words[1]}`)
  }

  // A first word longer than the cap has no word boundary to cut at.
  return kept || `${base.slice(0, max - 1)}…`
}


/**
 * The heading inside a card: the prompt's full name, unshortened — there is
 * room for it there. Use shortLabel for the header badge instead.
 */
export function displayLabel({ promptTitle, identity }) {
  return promptTitle || identity?.label || 'Document'
}
