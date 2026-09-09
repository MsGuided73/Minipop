import { describe, test, expect } from 'vitest'
import { renderMarkdown, renderInline, escapeHtml } from './markdown'

describe('escaping — the input is untrusted model output', () => {
  test('neutralises script tags', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toMatch(/<script/i)
    expect(out).toContain('&lt;script&gt;')
  })

  test('neutralises injected event handlers', () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(out).not.toMatch(/<img/i)
    expect(out).toContain('&lt;img')
  })

  test('escapes before formatting, so markup cannot smuggle tags through bold', () => {
    const out = renderInline('**<b>bold</b>**')
    // The emitted <strong> is ours; the inner <b> is inert text.
    expect(out).toBe('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>')
  })

  test('escapes quotes so attribute contexts cannot be broken', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b')
  })
})

describe('block rendering', () => {
  test('headings h1..h4', () => {
    expect(renderMarkdown('# One')).toBe('<h1>One</h1>')
    expect(renderMarkdown('#### Four')).toBe('<h4>Four</h4>')
  })

  test('paragraphs join wrapped lines', () => {
    expect(renderMarkdown('alpha\nbeta')).toBe('<p>alpha beta</p>')
  })

  test('horizontal rule', () => {
    expect(renderMarkdown('---')).toBe('<hr>')
  })

  test('blockquote', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>')
  })

  test('bullet list', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  test('nested bullets close correctly', () => {
    const out = renderMarkdown('- a\n  - a1\n- b')
    expect(out).toBe('<ul><li>a</li><ul><li>a1</li></ul><li>b</li></ul>')
  })

  test('ordered list', () => {
    expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>')
  })

  test('a heading directly after a paragraph is not swallowed into it', () => {
    expect(renderMarkdown('text\n## Section')).toBe('<p>text</p><h2>Section</h2>')
  })
})

describe('inline rendering', () => {
  test('bold and italic', () => {
    expect(renderInline('**b** and *i*')).toBe('<strong>b</strong> and <em>i</em>')
  })

  test('inline code', () => {
    expect(renderInline('use `npm run dev`')).toBe('use <code>npm run dev</code>')
  })

  test('bold is not mangled into italic', () => {
    expect(renderInline('**bold**')).toBe('<strong>bold</strong>')
  })
})

describe('edge cases', () => {
  test('empty input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(null)).toBe('')
    expect(renderMarkdown(undefined)).toBe('')
  })
})
