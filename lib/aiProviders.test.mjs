import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { runCompletion, getProvider } from './aiProviders.js'

// These cover the provider plumbing that used to run in the browser and now
// runs here: auto-continue, truncation detection per provider, and the request
// shapes each API expects. Ported from src/services/aiService.test.js when the
// call moved server-side so the user's key would stop travelling to the page.

function jsonResponse(body) {
  return { ok: true, json: async () => body }
}

const openaiReply = (content, truncated = false) =>
  jsonResponse({ choices: [{ message: { content }, finish_reason: truncated ? 'length' : 'stop' }] })

const anthropicReply = (text, truncated = false) =>
  jsonResponse({ content: [{ type: 'text', text }], stop_reason: truncated ? 'max_tokens' : 'end_turn' })

const googleReply = (text, truncated = false) =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason: truncated ? 'MAX_TOKENS' : 'STOP' }] })

const bodyOf = (call) => JSON.parse(call[1].body)

const complete = (opts) => runCompletion({
  apiKey: 'sk-test',
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
  ...opts,
})

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auto-continue disabled', () => {
  test('makes a single call even when the response was truncated', async () => {
    fetchMock.mockResolvedValueOnce(openaiReply('half an answer', true))

    const { text } = await complete({})

    expect(text).toBe('half an answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('auto-continue enabled', () => {
  test('does not continue when the model finished on its own', async () => {
    fetchMock.mockResolvedValueOnce(openaiReply('a complete answer', false))

    const { text } = await complete({ autoContinue: true })

    expect(text).toBe('a complete answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('re-prompts and concatenates until the model stops on its own (OpenAI)', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one ', true))
      .mockResolvedValueOnce(openaiReply('part two ', true))
      .mockResolvedValueOnce(openaiReply('the end', false))

    const { text, rounds } = await complete({ autoContinue: true })

    expect(text).toBe('part one part two the end')
    expect(rounds).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('feeds each partial back as an assistant turn followed by a continue instruction', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one', true))
      .mockResolvedValueOnce(openaiReply(' and done', false))

    await complete({ autoContinue: true })

    const second = bodyOf(fetchMock.mock.calls[1]).messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: 'part one' })
    expect(second.at(-1).role).toBe('user')
    expect(second.at(-1).content).toMatch(/continue from exactly where you stopped/i)
  })

  test('stops after the round cap so an always-truncating model cannot loop forever', async () => {
    fetchMock.mockResolvedValue(openaiReply('more', true))

    const { text } = await complete({ autoContinue: true })

    // 1 initial call + 5 continuation rounds.
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(text).toBe('more'.repeat(6))
  })

  test('stops when a continuation comes back empty', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one', true))
      .mockResolvedValueOnce(openaiReply('', true))

    const { text } = await complete({ autoContinue: true })

    expect(text).toBe('part one')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('detects Anthropic max_tokens truncation', async () => {
    fetchMock
      .mockResolvedValueOnce(anthropicReply('claude part one', true))
      .mockResolvedValueOnce(anthropicReply(' claude finish', false))

    const { text } = await complete({ model: 'claude-haiku-4-5-20251001', autoContinue: true })

    expect(text).toBe('claude part one claude finish')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('detects Google MAX_TOKENS truncation and resumes with a model turn', async () => {
    fetchMock
      .mockResolvedValueOnce(googleReply('gemma part one', true))
      .mockResolvedValueOnce(googleReply(' gemma finish', false))

    const { text } = await complete({ model: 'gemma-4-31b-it', autoContinue: true })

    expect(text).toBe('gemma part one gemma finish')

    const contents = bodyOf(fetchMock.mock.calls[1]).contents
    expect(contents.at(-2)).toEqual({ role: 'model', parts: [{ text: 'gemma part one' }] })
    expect(contents.at(-1).role).toBe('user')
  })
})

describe('provider request shape', () => {
  test('omits temperature for OpenAI reasoning models', async () => {
    fetchMock.mockResolvedValueOnce(openaiReply('ok'))

    await complete({ model: 'o1-preview', temperature: 0.7 })

    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('temperature')
  })

  test('does not attach the search tool to Gemma models', async () => {
    fetchMock.mockResolvedValueOnce(googleReply('ok'))

    await complete({ model: 'gemma-4-31b-it', useSearch: true })

    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('tools')
  })

  test('sends the key in each provider’s own slot, and never in the body', async () => {
    fetchMock.mockResolvedValueOnce(anthropicReply('ok'))
    await complete({ apiKey: 'sk-ant-secret', model: 'claude-haiku-4-5-20251001' })
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-secret')
    expect(fetchMock.mock.calls[0][1].body).not.toContain('sk-ant-secret')

    fetchMock.mockResolvedValueOnce(openaiReply('ok'))
    await complete({ apiKey: 'sk-openai-secret' })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer sk-openai-secret')
    expect(fetchMock.mock.calls[1][1].body).not.toContain('sk-openai-secret')
  })

  test('surfaces the provider’s own error message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 401,
      json: async () => ({ error: { message: 'Incorrect API key provided' } }),
    })

    await expect(complete({})).rejects.toThrow(/Incorrect API key provided/)
  })
})

describe('getProvider', () => {
  test.each([
    ['gpt-4o', 'openai'],
    ['o1-preview', 'openai'],
    ['claude-haiku-4-5-20251001', 'anthropic'],
    ['gemini-2.0-flash', 'google'],
    ['gemma-4-31b-it', 'google'],
    ['nano-banana', 'google'],
    ['', 'openai'],
  ])('%s → %s', (model, provider) => {
    expect(getProvider(model)).toBe(provider)
  })
})
