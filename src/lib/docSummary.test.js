import { describe, test, expect } from 'vitest'
import { docTitle, previewText, docMeta, metaLine, threadToMarkdown } from './docSummary'

const GUIDE = `# Build and sell five AI client systems

Identify which automation a business **actually** needs, then write a single
prompt to build it.

## Step 1 — Diagnose

Ask about the [intake process](https://example.com) first.

## Step 2 — Build

\`\`\`js
const ignored = 'code should not leak into a preview'
\`\`\`

- Ship the smallest thing that works
`

describe('docTitle', () => {
  test('returns the first heading text', () => {
    expect(docTitle(GUIDE)).toBe('Build and sell five AI client systems')
  })

  test('returns null when the document opens with prose', () => {
    expect(docTitle('Just a paragraph, no heading at all.')).toBeNull()
  })

  test('strips inline markdown from the heading', () => {
    expect(docTitle('## The **$15K** `Myth`')).toBe('The $15K Myth')
  })

  test('ignores a heading inside a fenced code block', () => {
    expect(docTitle('```\n# not a title\n```\n\n# Real Title')).toBe('Real Title')
  })

  test('handles empty and nullish input', () => {
    expect(docTitle('')).toBeNull()
    expect(docTitle(undefined)).toBeNull()
  })
})

describe('previewText', () => {
  test('drops headings and returns prose', () => {
    const preview = previewText(GUIDE)
    expect(preview).not.toContain('Step 1')
    expect(preview).toMatch(/^Identify which automation a business actually needs/)
  })

  test('unwraps bold, links and inline code', () => {
    expect(previewText('A **bold** [link](http://x.dev) and `code`.'))
      .toBe('A bold link and code.')
  })

  test('drops images entirely', () => {
    expect(previewText('![a diagram](x.png) Then the text.')).toBe('Then the text.')
  })

  test('excludes fenced code content', () => {
    expect(previewText(GUIDE)).not.toContain('const ignored')
  })

  test('strips list markers but keeps the item text', () => {
    expect(previewText('- first\n- second\n1. third')).toBe('first second third')
  })

  test('truncates on a word boundary with an ellipsis', () => {
    const preview = previewText('alpha bravo charlie delta echo foxtrot', 20)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.length).toBeLessThanOrEqual(21)
    expect(preview).not.toContain('foxtrot')
  })

  test('returns short text unchanged and un-ellipsised', () => {
    expect(previewText('Short enough.')).toBe('Short enough.')
  })

  test('returns an empty string for an empty document', () => {
    expect(previewText('')).toBe('')
  })
})

describe('unclosed code fences', () => {
  // A model that runs out of context mid-code-block leaves one fence behind.
  const TRUNCATED = `# My Document

Some intro text before the code block.

\`\`\`js
const cut = 'off'

## A real section

Prose that must still reach the card.
`

  test('keeps the content after a stray fence in the preview', () => {
    const preview = previewText(TRUNCATED)
    expect(preview).toContain('Prose that must still reach the card')
    expect(preview).toContain('Some intro text')
  })

  test('still finds sections after a stray fence', () => {
    expect(docMeta(TRUNCATED).sections).toBe(1)
  })

  test('a balanced fence still hides its code', () => {
    expect(previewText('Intro.\n\n```js\nconst hidden = 1\n```\n\nOutro.'))
      .toBe('Intro. Outro.')
  })
})

describe('docMeta', () => {
  test('counts sections excluding the document title', () => {
    expect(docMeta(GUIDE).sections).toBe(2)
  })

  test('counts words when there is no structure', () => {
    expect(docMeta('one two three').words).toBe(3)
  })

  test('does not count fenced code as words', () => {
    expect(docMeta('two words\n```\nlots of code in here\n```').words).toBe(2)
  })
})

describe('metaLine', () => {
  test('reports sections when the document has them', () => {
    expect(metaLine(GUIDE, 1)).toBe('1 source · 2 sections')
  })

  test('falls back to a word count for an unstructured document', () => {
    expect(metaLine('one two three', 2)).toBe('2 sources · 3 words')
  })

  test('reports sources alone for an empty document', () => {
    expect(metaLine('', 0)).toBe('0 sources')
  })
})

describe('threadToMarkdown', () => {
  const doc = '# Doc\n\nBody.'

  test('returns the assistant answer alone when there are no follow-ups', () => {
    expect(threadToMarkdown([
      { role: 'user', content: 'kickoff', hidden: true },
      { role: 'assistant', content: doc },
    ])).toBe(doc)
  })

  test('appends follow-up exchanges below the document', () => {
    const out = threadToMarkdown([
      { role: 'user', content: 'kickoff', hidden: true },
      { role: 'assistant', content: doc },
      { role: 'user', content: 'Shorten section 3' },
      { role: 'assistant', content: 'Shorter now.' },
    ])
    expect(out).toContain(doc)
    expect(out).toContain('## Follow-ups')
    expect(out).toContain('#### Shorten section 3')
    expect(out).toContain('Shorter now.')
  })

  test('returns an empty string before the first assistant reply', () => {
    expect(threadToMarkdown([{ role: 'user', content: 'kickoff', hidden: true }])).toBe('')
    expect(threadToMarkdown([])).toBe('')
  })
})
