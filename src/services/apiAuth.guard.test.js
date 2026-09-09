import { describe, test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Every /api/v1 route requires a Supabase session, so any module that talks to
// our own API must go through apiFetch (which attaches the token). A bare
// fetch() 401s at runtime.
//
// This guard exists because a real regression slipped through: YouTubeNode built
// its URL into a variable first —
//
//   const localProxyUrl = `/api/transcript?...`
//   const res = await fetch(localProxyUrl)
//
// — so a grep for `fetch('/api` found nothing and the file looked clean while
// transcript fetching was broken. Checking for the *string* rather than the call
// shape catches it regardless of how the URL is assembled.

const SRC = path.resolve(__dirname, '..')
const EXEMPT = new Set(['apiClient.js'])   // the wrapper itself

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(full)
    if (!/\.(js|jsx)$/.test(e.name)) return []
    if (/\.test\.(js|jsx)$/.test(e.name)) return []
    return [full]
  })
}

describe('API auth guard', () => {
  test('every module referencing our API imports apiFetch', () => {
    const offenders = []

    for (const file of sourceFiles(SRC)) {
      if (EXEMPT.has(path.basename(file))) continue
      const code = fs.readFileSync(file, 'utf8')

      // Does this file reference our own API surface at all?
      if (!/['"`]\/api\//.test(code)) continue

      const importsApiFetch = /import\s*\{[^}]*\bapiFetch\b[^}]*\}\s*from\s*['"][^'"]*apiClient['"]/.test(code)
      if (!importsApiFetch) {
        offenders.push(path.relative(SRC, file))
      }
    }

    expect(offenders, `these files reference /api/ but never import apiFetch, so their requests are unauthenticated:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  test('no module calls bare fetch() on an inline /api path', () => {
    const offenders = []

    for (const file of sourceFiles(SRC)) {
      if (EXEMPT.has(path.basename(file))) continue
      const code = fs.readFileSync(file, 'utf8')
      // (?<!api) so apiFetch('/api/...') is not flagged
      const bare = code.match(/(?<!api)\bfetch\(\s*['"`]\/api\//g)
      if (bare) offenders.push(`${path.relative(SRC, file)} (${bare.length})`)
    }

    expect(offenders, `bare fetch() on an /api path:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
