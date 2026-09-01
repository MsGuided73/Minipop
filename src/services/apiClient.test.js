import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub the browser Supabase client so these tests never need real credentials.
const getAccessTokenMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('./supabaseClient', () => ({
  getAccessToken: (...a) => getAccessTokenMock(...a),
  supabase: { auth: { signOut: (...a) => signOutMock(...a) } },
  isAuthConfigured: true,
}))

const { apiFetch, AuthExpiredError } = await import('./apiClient')

beforeEach(() => {
  global.fetch = vi.fn()
  getAccessTokenMock.mockReset()
  signOutMock.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('apiFetch', () => {
  test('attaches the session token as a bearer header', async () => {
    getAccessTokenMock.mockResolvedValue('jwt-123')
    global.fetch.mockResolvedValue({ ok: true, status: 200 })

    await apiFetch('/api/v1/prompts')

    const [, init] = global.fetch.mock.calls[0]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-123')
  })

  test('preserves caller headers alongside the token', async () => {
    getAccessTokenMock.mockResolvedValue('jwt-123')
    global.fetch.mockResolvedValue({ ok: true, status: 200 })

    await apiFetch('/api/v1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const headers = new Headers(global.fetch.mock.calls[0][1].headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Authorization')).toBe('Bearer jwt-123')
  })

  test('sends no Authorization header when there is no session', async () => {
    getAccessTokenMock.mockResolvedValue(null)
    global.fetch.mockResolvedValue({ ok: true, status: 200 })

    await apiFetch('/api/v1/prompts')

    expect(new Headers(global.fetch.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })

  test('clears the dead session and throws on 401 so the app returns to sign-in', async () => {
    getAccessTokenMock.mockResolvedValue('expired-jwt')
    global.fetch.mockResolvedValue({ ok: false, status: 401 })

    await expect(apiFetch('/api/v1/prompts')).rejects.toBeInstanceOf(AuthExpiredError)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  test('passes other error statuses through for the caller to handle', async () => {
    getAccessTokenMock.mockResolvedValue('jwt-123')
    global.fetch.mockResolvedValue({ ok: false, status: 500 })

    const res = await apiFetch('/api/v1/prompts')
    expect(res.status).toBe(500)
    expect(signOutMock).not.toHaveBeenCalled()
  })
})
