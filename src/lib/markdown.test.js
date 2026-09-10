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

  test('a nested list is a child of its item, not a sibling', () => {
    // A <ul> may only contain <li>, so the sublist has to sit inside the item
    // it belongs to; as a sibling it indents inconsistently across browsers.
    const out = renderMarkdown('- a\n  - a1\n- b')
    expect(out).toBe('<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>')
  })

  test('nests to more than one level', () => {
    expect(renderMarkdown('- a\n  - b\n    - c')).toBe(
      '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>'
    )
  })

  test('keeps an ordered sublist ordered', () => {
    expect(renderMarkdown('1. one\n   1. one-a')).toBe(
      '<ol><li>one<ol><li>one-a</li></ol></li></ol>'
    )
  })

  test('renders task list items as checkboxes', () => {
    const out = renderMarkdown('- [ ] todo\n- [x] done')
    expect(out).toContain('<input type="checkbox" disabled>todo')
    expect(out).toContain('<input type="checkbox" disabled checked>done')
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

// ── Capabilities the reader needs to look like a real document ──────────────

describe('links', () => {
  test('renders a link, opening it away from the canvas', () => {
    expect(renderMarkdown('see [docs](https://example.com/a?b=1&c=2)')).toBe(
      '<p>see <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>'
    )
  })

  test('allows mailto, relative paths and anchors', () => {
    expect(renderMarkdown('[mail](mailto:a@b.com)')).toContain('href="mailto:a@b.com"')
    expect(renderMarkdown('[rel](/boards/1)')).toContain('href="/boards/1"')
    expect(renderMarkdown('[anchor](#section)')).toContain('href="#section"')
  })

  test('drops a javascript: URL and keeps only the text', () => {
    const out = renderMarkdown('[click](javascript:alert)')
    expect(out).toBe('<p>click</p>')
    expect(out).not.toContain('javascript')
  })

  test('drops a javascript: URL disguised with control characters', () => {
    // Browsers ignore tabs and newlines when resolving a scheme.
    const out = renderMarkdown('[click](java\tscript:alert(1))')
    expect(out).not.toContain('href')
  })

  test('drops data: and vbscript: URLs', () => {
    expect(renderMarkdown('[x](data:text/html;base64,PHN2Zz4=)')).not.toContain('href')
    expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('href')
  })
})

describe('images', () => {
  test('renders an http image lazily', () => {
    expect(renderMarkdown('![a chart](https://example.com/c.png)')).toBe(
      '<p><img src="https://example.com/c.png" alt="a chart" loading="lazy"></p>'
    )
  })

  test('falls back to the alt text for an unsafe source', () => {
    expect(renderMarkdown('![boom](javascript:alert)')).toBe('<p>boom</p>')
  })
})

describe('tables', () => {
  const TABLE = '| Step | Owner |\n|---|---:|\n| Build | You |'

  test('renders a header and body', () => {
    const out = renderMarkdown(TABLE)
    expect(out).toContain('<table><thead><tr><th>Step</th>')
    expect(out).toContain('<tbody><tr><td>Build</td>')
  })

  test('honours column alignment', () => {
    expect(renderMarkdown(TABLE)).toContain('<th style="text-align:right">Owner</th>')
    expect(renderMarkdown('| a |\n|:-:|\n| b |')).toContain('style="text-align:center"')
  })

  test('pads a ragged row rather than breaking the table', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| only |')
    expect(out).toContain('<tr><td>only</td><td></td></tr>')
  })

  test('formats inline markup inside cells', () => {
    expect(renderMarkdown('| a |\n|---|\n| **bold** |')).toContain('<td><strong>bold</strong></td>')
  })

  test('leaves a pipe-free paragraph alone', () => {
    expect(renderMarkdown('not a table')).toBe('<p>not a table</p>')
  })
})

describe('fenced code', () => {
  test('preserves newlines and tags the language', () => {
    expect(renderMarkdown('```js\nconst a = 1\nconst b = 2\n```')).toBe(
      '<pre><code class="language-js">const a = 1\nconst b = 2</code></pre>'
    )
  })

  test('escapes markup inside a code block', () => {
    const out = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })

  test('does not format markdown inside a code block', () => {
    expect(renderMarkdown('```\n**not bold**\n```')).toContain('**not bold**')
  })

  test('closes an unterminated block at the end of the document', () => {
    expect(renderMarkdown('```\ncut off')).toBe('<pre><code>cut off</code></pre>')
  })
})

describe('inline edge cases', () => {
  test('leaves markdown inside a code span as typed', () => {
    expect(renderMarkdown('use `a**b**c` here')).toBe('<p>use <code>a**b**c</code> here</p>')
  })

  test('renders strikethrough and __bold__', () => {
    expect(renderMarkdown('~~old~~ and __new__')).toBe('<p><del>old</del> and <strong>new</strong></p>')
  })

  test('leaves snake_case identifiers alone', () => {
    expect(renderMarkdown('the user_id_field value')).toBe('<p>the user_id_field value</p>')
  })

  test('supports headings down to level six', () => {
    expect(renderMarkdown('###### deep')).toBe('<h6>deep</h6>')
  })
})
