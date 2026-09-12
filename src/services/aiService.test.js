import { describe, test, expect, vi, beforeEach } from 'vitest'

// The provider calls live on the server now (lib/aiProviders.js, tested in
// lib/aiProviders.test.mjs). What is left to test here is the half that stayed
// in the browser: that a completion goes to our own endpoint, carries what the
// caller asked for, and never carries a key — because there is no longer one
// here to carry.

const apiFetchMock = vi.fn()
vi.mock('./apiClient', () => ({
  apiFetch: (...args) => apiFetchMock(...args),
  AuthExpiredError: class extends Error {},
}))

const { callAI, generateCrossReferenceTable } = await import('./aiService')

const AI_NODE_ID = 'ai-1'
const nodes = [{ id: AI_NODE_ID, type: 'aiAssistantNode', data: { messages: [] } }]
const edges = []

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ text }) })
const failure = (status, body) => ({ ok: false, status, json: async () => body })

const bodyOf = (call) => JSON.parse(call[1].body)

beforeEach(() => {
  apiFetchMock.mockReset()
})

describe('completions go through our server', () => {
  test('posts to the completion endpoint and returns its text', async () => {
    apiFetchMock.mockResolvedValueOnce(ok('an answer'))

    const out = await callAI(AI_NODE_ID, 'hi', nodes, edges, 'gpt-4o')

    expect(out).toBe('an answer')
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/ai/complete')
    expect(apiFetchMock.mock.calls[0][1].method).toBe('POST')
  })

  test('sends the model and the assembled turns, and no key', async () => {
    apiFetchMock.mockResolvedValueOnce(ok('an answer'))

    await callAI(AI_NODE_ID, 'hello there', nodes, edges, 'gpt-4o')

    const body = bodyOf(apiFetchMock.mock.calls[0])
    expect(body.model).toBe('gpt-4o')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'hello there' })
    expect(JSON.stringify(body)).not.toMatch(/sk-/)
    expect(body).not.toHaveProperty('apiKey')
  })

  test('passes auto-continue through, since the server runs the loop', async () => {
    apiFetchMock.mockResolvedValueOnce(ok('an answer'))

    await callAI(AI_NODE_ID, 'hi', nodes, edges, 'gpt-4o', { autoContinue: true })

    expect(bodyOf(apiFetchMock.mock.calls[0]).autoContinue).toBe(true)
  })

  test('non-chat prompts take the same path', async () => {
    apiFetchMock.mockResolvedValueOnce(ok('| a | b |'))

    const out = await generateCrossReferenceTable('report body', 'gpt-4o', { autoContinue: true })

    expect(out).toBe('| a | b |')
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/ai/complete')
  })
})

describe('when the call cannot be made', () => {
  test('a missing key is reported as something the user can fix', async () => {
    apiFetchMock.mockResolvedValueOnce(failure(428, {
      error: 'No OpenAI key saved',
      detail: 'Add one in Settings to use gpt-4o.',
    }))

    await expect(callAI(AI_NODE_ID, 'hi', nodes, edges, 'gpt-4o'))
      .rejects.toThrow('No OpenAI key saved. Add one in Settings to use gpt-4o.')
  })

  test("the provider's own words survive the trip back", async () => {
    apiFetchMock.mockResolvedValueOnce(failure(502, { error: 'Incorrect API key provided' }))

    await expect(callAI(AI_NODE_ID, 'hi', nodes, edges, 'gpt-4o'))
      .rejects.toThrow(/Incorrect API key provided/)
  })

  test('an unexplained failure still says something', async () => {
    apiFetchMock.mockResolvedValueOnce(failure(500, {}))

    await expect(callAI(AI_NODE_ID, 'hi', nodes, edges, 'gpt-4o'))
      .rejects.toThrow(/could not be reached \(500\)/)
  })
})
