import { describe, it, expect } from 'vitest'
import {
  isAllowedOrigin,
  isSameHost,
  requestHost,
  parseAllowList,
} from './corsOrigin.js'

const PROD = 'https://contentloom.fyi'
const PROD_HEADERS = { host: 'contentloom.fyi' }

// The list the old code fell back to when ALLOWED_ORIGINS was unset. Kept in
// the tests because the regression was specifically "production origin absent
// from the list", and that must now be survivable.
const DEV_ONLY = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']

describe('isAllowedOrigin — the outage', () => {
  it('allows the site its own origin even when the allow-list has only dev entries', () => {
    // Arrange: exactly the production misconfiguration that took the site down.
    // Act
    const allowed = isAllowedOrigin(PROD, { allowList: DEV_ONLY, headers: PROD_HEADERS })
    // Assert
    expect(allowed).toBe(true)
  })

  it('allows the site its own origin with no allow-list configured at all', () => {
    expect(isAllowedOrigin(PROD, { headers: PROD_HEADERS })).toBe(true)
  })

  it('still allows requests with no Origin header (curl, health checks, SSR)', () => {
    expect(isAllowedOrigin(undefined, { headers: PROD_HEADERS })).toBe(true)
    expect(isAllowedOrigin('', { headers: PROD_HEADERS })).toBe(true)
  })
})

describe('isAllowedOrigin — still says no to everyone else', () => {
  it('rejects an unrelated origin', () => {
    expect(isAllowedOrigin('https://evil.example', { headers: PROD_HEADERS })).toBe(false)
  })

  it('rejects a lookalike host', () => {
    expect(isAllowedOrigin('https://contentloom.fyi.evil.example', { headers: PROD_HEADERS })).toBe(false)
    expect(isAllowedOrigin('https://notcontentloom.fyi', { headers: PROD_HEADERS })).toBe(false)
  })

  it('rejects a subdomain that was not asked for', () => {
    expect(isAllowedOrigin('https://api.contentloom.fyi', { headers: PROD_HEADERS })).toBe(false)
  })

  it('rejects an opaque origin', () => {
    // A sandboxed iframe or a file:// page sends the literal string "null".
    expect(isAllowedOrigin('null', { headers: PROD_HEADERS })).toBe(false)
  })

  it('rejects a malformed origin instead of throwing', () => {
    expect(isAllowedOrigin('not a url', { headers: PROD_HEADERS })).toBe(false)
    expect(isAllowedOrigin('://', { headers: PROD_HEADERS })).toBe(false)
  })

  it('honours the allow-list for a genuinely different origin', () => {
    const opts = { allowList: ['https://studio.example'], headers: PROD_HEADERS }
    expect(isAllowedOrigin('https://studio.example', opts)).toBe(true)
    expect(isAllowedOrigin('https://other.example', opts)).toBe(false)
  })
})

describe('isAllowedOrigin — development still works', () => {
  it('allows the Vite dev server calling the API on another port', () => {
    // Vite serves :5173 and proxies /api to :3000, so Origin and Host differ
    // and the allow-list is what permits it.
    const allowed = isAllowedOrigin('http://localhost:5173', {
      allowList: DEV_ONLY,
      headers: { host: 'localhost:3000' },
    })
    expect(allowed).toBe(true)
  })

  it('treats a different port as a different host', () => {
    expect(isSameHost('http://localhost:5173', 'localhost:3000')).toBe(false)
  })
})

describe('isSameHost', () => {
  it('matches on host regardless of scheme', () => {
    // http is redirected to https at the proxy; a same-host request is still
    // this site either way.
    expect(isSameHost('http://contentloom.fyi', 'contentloom.fyi')).toBe(true)
    expect(isSameHost('https://contentloom.fyi', 'contentloom.fyi')).toBe(true)
  })

  it('ignores case', () => {
    expect(isSameHost('https://ContentLoom.FYI', 'contentloom.fyi')).toBe(true)
  })

  it('matches when a port is present on both sides', () => {
    expect(isSameHost('http://localhost:3000', 'localhost:3000')).toBe(true)
  })

  it('is false when either side is missing', () => {
    expect(isSameHost('', 'contentloom.fyi')).toBe(false)
    expect(isSameHost(PROD, '')).toBe(false)
  })
})

describe('requestHost', () => {
  it('prefers X-Forwarded-Host, which is where the real host arrives behind a proxy', () => {
    const headers = { host: 'internal-container:3000', 'x-forwarded-host': 'contentloom.fyi' }
    expect(requestHost(headers)).toBe('contentloom.fyi')
  })

  it('takes the first entry when a proxy chain appends several', () => {
    expect(requestHost({ 'x-forwarded-host': 'contentloom.fyi, inner.local' })).toBe('contentloom.fyi')
  })

  it('falls back to Host', () => {
    expect(requestHost({ host: 'contentloom.fyi' })).toBe('contentloom.fyi')
  })

  it('lower-cases and trims', () => {
    expect(requestHost({ host: '  ContentLoom.FYI ' })).toBe('contentloom.fyi')
  })

  it('returns empty string when there is no host at all', () => {
    expect(requestHost({})).toBe('')
    expect(requestHost()).toBe('')
  })
})

describe('parseAllowList', () => {
  it('splits, trims and drops empties', () => {
    expect(parseAllowList(' https://a.example , https://b.example ,, ')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('returns an empty list for unset or blank input', () => {
    expect(parseAllowList(undefined)).toEqual([])
    expect(parseAllowList('')).toEqual([])
    expect(parseAllowList('   ')).toEqual([])
  })
})
