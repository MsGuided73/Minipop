import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractVariables,
  renderPrompt,
  reconcileVariables,
  suggestVariationTitle,
  createPrompt,
} from './promptService'

describe('extractVariables', () => {
  test('returns empty array for empty body', () => {
    expect(extractVariables('')).toEqual([])
    expect(extractVariables(null)).toEqual([])
  })

  test('extracts unique variable names in declaration order', () => {
    const body = 'Analyze {{video_type}} for {{audience}} then {{video_type}} again'
    expect(extractVariables(body)).toEqual(['video_type', 'audience'])
  })

  test('ignores malformed markers', () => {
    expect(extractVariables('{{ 1bad }} {{good_one}}')).toEqual(['good_one'])
  })
})

describe('renderPrompt', () => {
  test('substitutes provided values', () => {
    const out = renderPrompt('Hello {{name}}', { name: 'World' })
    expect(out).toBe('Hello World')
  })

  test('leaves the marker intact when a value is missing or blank', () => {
    expect(renderPrompt('Hi {{name}}', {})).toBe('Hi {{name}}')
    expect(renderPrompt('Hi {{name}}', { name: '' })).toBe('Hi {{name}}')
  })
})

describe('reconcileVariables', () => {
  test('orders by appearance in the body and synthesizes missing defs', () => {
    const declared = [{ name: 'audience', label: 'Who', type: 'text', default: 'devs' }]
    const result = reconcileVariables('{{topic}} for {{audience}}', declared)
    expect(result.map(v => v.name)).toEqual(['topic', 'audience'])
    // synthesized def for the undeclared {{topic}}
    expect(result[0]).toMatchObject({ name: 'topic', label: 'Topic', type: 'text' })
    // declared def for {{audience}} is preserved
    expect(result[1]).toEqual(declared[0])
  })

  test('appends declared vars that are absent from the body', () => {
    const declared = [{ name: 'orphan', label: 'Orphan', type: 'text', default: '' }]
    const result = reconcileVariables('no markers here', declared)
    expect(result.map(v => v.name)).toEqual(['orphan'])
  })
})

describe('suggestVariationTitle', () => {
  test('appends (custom) to a base title', () => {
    expect(suggestVariationTitle('Forensic Analyst')).toBe('Forensic Analyst (custom)')
  })

  test('bumps the counter when the title ends in exactly "(custom)"', () => {
    expect(suggestVariationTitle('Forensic Analyst (custom)')).toBe('Forensic Analyst (custom 2)')
  })

  test('falls back for an empty title', () => {
    expect(suggestVariationTitle('')).toBe('Untitled (custom)')
  })
})

describe('createPrompt', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('POSTs the payload as JSON and returns the parsed body', async () => {
    const created = { id: 'new-1', title: 'My Prompt' }
    global.fetch.mockResolvedValue({ ok: true, json: async () => created })

    const payload = { title: 'My Prompt', body: 'Do {{x}}', tags: ['a'] }
    const result = await createPrompt(payload)

    expect(result).toEqual(created)
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/prompts', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
  })

  test('throws an informative error on a non-ok response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Bad title', detail: 'too long' }),
    })

    await expect(createPrompt({ title: '' })).rejects.toThrow('Bad title — too long (HTTP 400)')
  })
})
