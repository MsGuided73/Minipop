import { describe, test, expect } from 'vitest'
import {
  normalizeRumbleUrl,
  rumbleVideoId,
  parseMetadata,
  assertDurationAllowed,
  joinParts,
  MAX_DURATION_SECONDS,
} from './rumble.js'
import { createJobStore } from './jobStore.js'

describe('normalizeRumbleUrl', () => {
  test('accepts a Rumble video page and drops query and hash', () => {
    expect(normalizeRumbleUrl('https://rumble.com/v6abc12-some-title.html?e9s=src#t=5'))
      .toBe('https://rumble.com/v6abc12-some-title.html')
  })

  test('accepts the www host', () => {
    expect(normalizeRumbleUrl('https://www.rumble.com/v6abc12-x.html')).toBe('https://rumble.com/v6abc12-x.html')
  })

  test('rejects other hosts, including look-alikes', () => {
    expect(normalizeRumbleUrl('https://youtube.com/watch?v=abcdefghijk')).toBeNull()
    expect(normalizeRumbleUrl('https://rumble.com.evil.example/v1.html')).toBeNull()
    expect(normalizeRumbleUrl('https://evil.example/rumble.com/v1.html')).toBeNull()
  })

  test('rejects non-http schemes, bare hosts and junk', () => {
    expect(normalizeRumbleUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeRumbleUrl('https://rumble.com/')).toBeNull()
    expect(normalizeRumbleUrl('not a url')).toBeNull()
    expect(normalizeRumbleUrl(undefined)).toBeNull()
  })
})

describe('rumbleVideoId', () => {
  test('reads the id from a page url', () => {
    expect(rumbleVideoId('https://rumble.com/v6abc12-some-title.html')).toBe('v6abc12')
  })

  test('reads the id from an embed url', () => {
    expect(rumbleVideoId('https://rumble.com/embed/v6ABC12/')).toBe('v6abc12')
  })

  test('returns null when there is no id', () => {
    expect(rumbleVideoId('https://rumble.com/c/SomeChannel')).toBeNull()
  })
})

describe('parseMetadata', () => {
  test('maps yt-dlp fields to the shape the canvas uses', () => {
    const meta = parseMetadata({ title: 'T', uploader: 'U', view_count: 5, duration: 90, thumbnail: 'x.jpg' })
    expect(meta).toMatchObject({ title: 'T', uploader: 'U', viewCount: 5, duration: 90, thumbnail: 'x.jpg', comments: [] })
  })

  test('falls back to safe defaults', () => {
    expect(parseMetadata({}).title).toBe('Rumble video')
  })
})

describe('assertDurationAllowed', () => {
  test('allows a normal video', () => {
    expect(() => assertDurationAllowed(3600)).not.toThrow()
  })

  test('refuses one past the limit with a readable message', () => {
    expect(() => assertDurationAllowed(MAX_DURATION_SECONDS + 1)).toThrow(/longer than 4 hours/)
  })
})

describe('joinParts', () => {
  test('joins parts and collapses whitespace', () => {
    expect(joinParts(['  hello\nworld ', '', 'again  '])).toBe('hello world again')
  })
})

describe('createJobStore', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))

  test('reports progress, then the result', async () => {
    const store = createJobStore({ ttlMs: 1000, maxRunning: 2 })
    let release
    const job = store.start('u1', async setStage => {
      setStage('Downloading…')
      await new Promise(resolve => { release = resolve })
      return { transcript: 'hi' }
    })
    expect(store.get('u1', job.id)).toEqual({ status: 'running', stage: 'Downloading…' })
    release()
    await tick()
    expect(store.get('u1', job.id)).toEqual({ status: 'done', transcript: 'hi' })
  })

  test('reports a failure with its message', async () => {
    const store = createJobStore({ ttlMs: 1000, maxRunning: 2 })
    const job = store.start('u1', async () => { throw new Error('boom') })
    await tick()
    expect(store.get('u1', job.id)).toEqual({ status: 'failed', error: 'boom' })
  })

  test("never shows one user another user's job", async () => {
    const store = createJobStore({ ttlMs: 1000, maxRunning: 2 })
    const job = store.start('u1', async () => ({ transcript: 'secret' }))
    await tick()
    expect(store.get('u2', job.id)).toBeNull()
    expect(store.get('u1', 'no-such-job')).toBeNull()
  })

  test('refuses new work while every slot is busy', () => {
    const store = createJobStore({ ttlMs: 1000, maxRunning: 1 })
    store.start('u1', () => new Promise(() => {}))
    expect(store.start('u2', async () => ({}))).toBeNull()
  })
})
