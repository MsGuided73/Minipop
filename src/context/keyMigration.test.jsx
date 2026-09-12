import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'

// The one-time carry of keys that were saved in this browser before keys
// belonged to the account. It matters that this is right on the first try:
// users cannot read the old key out of the app to re-enter it (the field was
// a password input), so a migration that drops one loses it for good.

const apiFetchMock = vi.fn()
vi.mock('../services/apiClient', () => ({
  apiFetch: (...args) => apiFetchMock(...args),
  AuthExpiredError: class extends Error {},
}))

const { CanvasProvider, useCanvas } = await import('./CanvasContext')

const b64 = (s) => btoa(unescape(encodeURIComponent(s)))

const listing = (keys) => ({ ok: true, status: 200, json: async () => keys })
const saved = (provider, hint) => ({ ok: true, status: 200, json: async () => ({ provider, hint }) })

// Every PUT the migration made, as [provider, key].
const uploads = () => apiFetchMock.mock.calls
  .filter(([path, opts]) => opts?.method === 'PUT')
  .map(([path, opts]) => [path.split('/').pop(), JSON.parse(opts.body).key])

function Harness() {
  useCanvas()
  return null
}

const mount = () => render(<CanvasProvider><Harness /></CanvasProvider>)

beforeEach(() => {
  localStorage.clear()
  apiFetchMock.mockReset()
  // Everything the provider fetches on mount that is not about keys.
  apiFetchMock.mockImplementation(async (path) => {
    if (path === '/api/v1/keys') return listing([])
    return { ok: true, status: 200, json: async () => [] }
  })
})

afterEach(() => {
  localStorage.clear()
})

describe('legacy keys in this browser', () => {
  test('are uploaded to the account and cleared from localStorage', async () => {
    localStorage.setItem('poppyai_apikey', b64('sk-proj-legacy-openai'))
    localStorage.setItem('poppyai_gemini_key', b64('AIzaSy-legacy-google'))

    apiFetchMock.mockImplementation(async (path, opts) => {
      if (opts?.method === 'PUT') return saved(path.split('/').pop(), 'sk-…acy')
      if (path === '/api/v1/keys') return listing([])
      return { ok: true, status: 200, json: async () => [] }
    })

    mount()

    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(uploads()).toEqual(expect.arrayContaining([
      ['openai', 'sk-proj-legacy-openai'],
      ['google', 'AIzaSy-legacy-google'],
    ]))

    // The local copy going away is the point: otherwise the old exposure stays.
    expect(localStorage.getItem('poppyai_apikey')).toBeNull()
    expect(localStorage.getItem('poppyai_gemini_key')).toBeNull()
  })

  test('never overwrite a key already on the account', async () => {
    localStorage.setItem('poppyai_apikey', b64('sk-proj-stale-local'))

    apiFetchMock.mockImplementation(async (path, opts) => {
      if (opts?.method === 'PUT') return saved('openai', 'sk-…new')
      if (path === '/api/v1/keys') return listing([{ provider: 'openai', hint: 'sk-…new' }])
      return { ok: true, status: 200, json: async () => [] }
    })

    mount()

    // The server's copy is the newer one by definition, so the local one is
    // discarded rather than uploaded over it.
    await waitFor(() => expect(localStorage.getItem('poppyai_apikey')).toBeNull())
    expect(uploads()).toHaveLength(0)
  })

  test('a failed upload keeps the local copy, so the next load can retry', async () => {
    localStorage.setItem('poppyai_apikey', b64('sk-proj-legacy-openai'))

    apiFetchMock.mockImplementation(async (path, opts) => {
      if (opts?.method === 'PUT') return { ok: false, status: 503, json: async () => ({ error: 'Key storage unavailable' }) }
      if (path === '/api/v1/keys') return listing([])
      return { ok: true, status: 200, json: async () => [] }
    })

    mount()

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(localStorage.getItem('poppyai_apikey')).toBe(b64('sk-proj-legacy-openai'))
  })

  test('nothing happens when this browser has none', async () => {
    mount()
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled())
    expect(uploads()).toHaveLength(0)
  })
})
