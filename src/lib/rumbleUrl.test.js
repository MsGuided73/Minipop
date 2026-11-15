import { describe, test, expect } from 'vitest'
import { isRumbleUrl } from './rumbleUrl'

describe('isRumbleUrl', () => {
  test('recognises a Rumble video link', () => {
    expect(isRumbleUrl('https://rumble.com/v6abc12-some-title.html')).toBe(true)
    expect(isRumbleUrl('  https://www.rumble.com/v6abc12-x.html  ')).toBe(true)
  })

  test('rejects other sites and look-alike hosts', () => {
    expect(isRumbleUrl('https://www.youtube.com/watch?v=abcdefghijk')).toBe(false)
    expect(isRumbleUrl('https://rumble.com.evil.example/v1.html')).toBe(false)
  })

  test('rejects the bare site and non-links', () => {
    expect(isRumbleUrl('https://rumble.com/')).toBe(false)
    expect(isRumbleUrl('some pasted words')).toBe(false)
    expect(isRumbleUrl(undefined)).toBe(false)
  })
})
