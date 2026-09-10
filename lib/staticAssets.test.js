import { describe, it, expect } from 'vitest'
import { isStaticAssetPath, assetNotFoundBody, ASSET_DIR } from './staticAssets.js'

describe('isStaticAssetPath — build artifacts', () => {
  it('claims the fingerprinted bundles that caused this', () => {
    expect(isStaticAssetPath('/assets/index-BmsAO39T.js')).toBe(true)
    expect(isStaticAssetPath('/assets/index-BcSqQC_i.css')).toBe(true)
  })

  it('claims anything under the assets directory, whatever its shape', () => {
    expect(isStaticAssetPath('/assets/')).toBe(true)
    expect(isStaticAssetPath('/assets/nested/deep/thing.woff2')).toBe(true)
    expect(isStaticAssetPath('/assets/no-extension-at-all')).toBe(true)
  })

  it('claims source maps', () => {
    expect(isStaticAssetPath('/assets/index-BmsAO39T.js.map')).toBe(true)
  })

  it('claims root-level static files by extension', () => {
    expect(isStaticAssetPath('/favicon.svg')).toBe(true)
    expect(isStaticAssetPath('/robots.txt')).toBe(true)
    expect(isStaticAssetPath('/manifest.json')).toBe(true)
    expect(isStaticAssetPath('/og-image.png')).toBe(true)
  })

  it('is case-insensitive about extensions', () => {
    expect(isStaticAssetPath('/LOGO.PNG')).toBe(true)
    expect(isStaticAssetPath('/Style.CSS')).toBe(true)
  })

  it('ignores a query string or fragment', () => {
    expect(isStaticAssetPath('/assets/index-abc123.css?v=2')).toBe(true)
    expect(isStaticAssetPath('/favicon.svg?cachebust=1')).toBe(true)
    expect(isStaticAssetPath('/favicon.svg#frag')).toBe(true)
  })
})

describe('isStaticAssetPath — application routes', () => {
  it('leaves the app entry point alone', () => {
    expect(isStaticAssetPath('/')).toBe(false)
  })

  it('leaves extensionless paths alone', () => {
    expect(isStaticAssetPath('/canvas')).toBe(false)
    expect(isStaticAssetPath('/board/abc-123')).toBe(false)
    expect(isStaticAssetPath('/api/health')).toBe(false)
  })

  it('leaves a route containing a dot alone', () => {
    // The extension list is explicit precisely so a user-named board with a
    // dot in it is still routed to the app rather than 404ed.
    expect(isStaticAssetPath('/board/my.canvas')).toBe(false)
    expect(isStaticAssetPath('/board/v1.2.3-draft')).toBe(false)
  })

  it('does not claim /assets without a trailing slash', () => {
    // Not inside the directory, and no extension — treat it as a route.
    expect(isStaticAssetPath('/assets')).toBe(false)
    expect(isStaticAssetPath('/assets-overview')).toBe(false)
  })

  it('does not claim a path that merely mentions assets deeper down', () => {
    expect(isStaticAssetPath('/board/assets/summary')).toBe(false)
  })

  it('rejects non-path and nullish input rather than guessing', () => {
    expect(isStaticAssetPath('')).toBe(false)
    expect(isStaticAssetPath(undefined)).toBe(false)
    expect(isStaticAssetPath(null)).toBe(false)
    expect(isStaticAssetPath('https://example.com/x.css')).toBe(false)
  })
})

describe('assetNotFoundBody', () => {
  it('names the path that was missing', () => {
    expect(assetNotFoundBody('/assets/index-abc.css')).toContain('/assets/index-abc.css')
  })

  it('lists the three causes worth checking', () => {
    const body = assetNotFoundBody('/assets/x.js')
    expect(body).toMatch(/stale page/i)
    expect(body).toMatch(/swapping/i)
    expect(body).toMatch(/did not emit/i)
  })

  it('is plain text, carrying no markup that a browser could try to render', () => {
    expect(assetNotFoundBody('/assets/x.js')).not.toMatch(/[<>]/)
  })
})

describe('ASSET_DIR', () => {
  it('matches the directory Vite builds into', () => {
    expect(ASSET_DIR).toBe('/assets/')
  })
})
