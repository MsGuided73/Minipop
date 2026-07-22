import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { callAI, generateCrossReferenceTable } from './aiService'

// Minimal canvas: one AI node, nothing connected. Keeps the tests focused on the
// request/continue plumbing rather than on context building.
const AI_NODE_ID = 'ai-1'
const nodes = [{ id: AI_NODE_ID, type: 'aiAssistantNode', data: { messages: [] } }]
const edges = []

function jsonResponse(body) {
  return { ok: true, json: async () => body }
}

// Provider payload builders — `truncated` drives the finish-reason field each API uses.
const openaiReply = (content, truncated = false) =>
  jsonResponse({ choices: [{ message: { content }, finish_reason: truncated ? 'length' : 'stop' }] })

const anthropicReply = (text, truncated = false) =>
  jsonResponse({ content: [{ type: 'text', text }], stop_reason: truncated ? 'max_tokens' : 'end_turn' })

const googleReply = (text, truncated = false) =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason: truncated ? 'MAX_TOKENS' : 'STOP' }] })

// The parsed request body of the Nth fetch call.
function bodyOf(call) {
  return JSON.parse(call[1].body)
}

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

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '')

    expect(out).toBe('half an answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('auto-continue enabled', () => {
  test('does not continue when the model finished on its own', async () => {
    fetchMock.mockResolvedValueOnce(openaiReply('a complete answer', false))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '', {
      autoContinue: true,
    })

    expect(out).toBe('a complete answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('re-prompts and concatenates until the model stops on its own (OpenAI)', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one ', true))
      .mockResolvedValueOnce(openaiReply('part two ', true))
      .mockResolvedValueOnce(openaiReply('the end', false))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '', {
      autoContinue: true,
    })

    expect(out).toBe('part one part two the end')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('feeds each partial back as an assistant turn followed by a continue instruction', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one', true))
      .mockResolvedValueOnce(openaiReply(' and done', false))

    await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '', { autoContinue: true })

    const second = bodyOf(fetchMock.mock.calls[1]).messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: 'part one' })
    expect(second.at(-1).role).toBe('user')
    expect(second.at(-1).content).toMatch(/continue from exactly where you stopped/i)
  })

  test('stops after the round cap so a always-truncating model cannot loop forever', async () => {
    fetchMock.mockResolvedValue(openaiReply('more', true))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '', {
      autoContinue: true,
    })

    // 1 initial call + 5 continuation rounds.
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(out).toBe('more'.repeat(6))
  })

  test('stops when a continuation comes back empty', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('part one', true))
      .mockResolvedValueOnce(openaiReply('', true))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'gpt-4o', '', '', {
      autoContinue: true,
    })

    expect(out).toBe('part one')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('detects Anthropic max_tokens truncation', async () => {
    fetchMock
      .mockResolvedValueOnce(anthropicReply('claude part one', true))
      .mockResolvedValueOnce(anthropicReply(' claude finish', false))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, '', 'claude-haiku-4-5-20251001', '', 'sk-ant', {
      autoContinue: true,
    })

    expect(out).toBe('claude part one claude finish')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('detects Google MAX_TOKENS truncation and resumes with a model turn', async () => {
    fetchMock
      .mockResolvedValueOnce(googleReply('gemma part one', true))
      .mockResolvedValueOnce(googleReply(' gemma finish', false))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, '', 'gemma-4-31b-it', 'goog-key', '', {
      autoContinue: true,
    })

    expect(out).toBe('gemma part one gemma finish')

    const contents = bodyOf(fetchMock.mock.calls[1]).contents
    expect(contents.at(-2)).toEqual({ role: 'model', parts: [{ text: 'gemma part one' }] })
    expect(contents.at(-1).role).toBe('user')
  })

  test('applies to non-chat prompts such as the cross-reference table', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiReply('| a | b |', true))
      .mockResolvedValueOnce(openaiReply('\n| c | d |', false))

    const out = await generateCrossReferenceTable('report body', 'sk-test', 'gpt-4o', '', '', {
      autoContinue: true,
    })

    expect(out).toBe('| a | b |\n| c | d |')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('provider request shape', () => {
  test('omits temperature for OpenAI reasoning models', async () => {
    fetchMock.mockResolvedValueOnce(openaiReply('ok'))

    await callAI(AI_NODE_ID, 'hi', nodes, edges, 'sk-test', 'o1-preview', '', '')

    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('temperature')
  })

  test('does not attach the search tool to Gemma models', async () => {
    fetchMock.mockResolvedValueOnce(googleReply('ok'))

    await callAI(AI_NODE_ID, 'hi', nodes, edges, '', 'gemma-4-31b-it', 'goog-key', '')

    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('tools')
  })

  test('throws a provider-specific message when the key is missing', async () => {
    await expect(
      callAI(AI_NODE_ID, 'hi', nodes, edges, '', 'claude-haiku-4-5-20251001', '', '')
    ).rejects.toThrow(/Anthropic API key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
