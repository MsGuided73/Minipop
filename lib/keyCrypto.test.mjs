import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { encryptKey, decryptKey, keyHint, keysMatch, isCryptoConfigured } from './keyCrypto.js'

const SECRET = 'a-test-secret-that-is-long-enough-to-pass'

describe('keyCrypto', () => {
  beforeEach(() => { process.env.KEY_ENCRYPTION_SECRET = SECRET })
  afterEach(() => { delete process.env.KEY_ENCRYPTION_SECRET })

  test('a key survives the round trip', () => {
    const key = 'sk-proj-abc123def456ghi789'
    expect(decryptKey(encryptKey(key))).toBe(key)
  })

  test('the same key encrypts differently every time, so rows do not match each other', () => {
    const a = encryptKey('sk-identical')
    const b = encryptKey('sk-identical')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
    expect(decryptKey(a)).toBe(decryptKey(b))
  })

  test('a tampered ciphertext fails instead of returning a different key', () => {
    const record = encryptKey('sk-proj-original')
    const flipped = Buffer.from(record.ciphertext, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptKey({ ...record, ciphertext: flipped.toString('base64') }))
      .toThrow(/could not be decrypted/)
  })

  test('a tampered auth tag fails', () => {
    const record = encryptKey('sk-proj-original')
    const tag = Buffer.from(record.tag, 'base64')
    tag[0] ^= 0xff
    expect(() => decryptKey({ ...record, tag: tag.toString('base64') }))
      .toThrow(/could not be decrypted/)
  })

  test('a row written under a different secret is unreadable', () => {
    const record = encryptKey('sk-proj-original')
    process.env.KEY_ENCRYPTION_SECRET = 'a-completely-different-secret-of-length'
    expect(() => decryptKey(record)).toThrow(/could not be decrypted/)
  })

  test('an incomplete row is rejected before it reaches the cipher', () => {
    expect(() => decryptKey({ ciphertext: 'x', iv: '', tag: 'y' })).toThrow(/incomplete/)
  })

  describe('without a secret configured', () => {
    beforeEach(() => { delete process.env.KEY_ENCRYPTION_SECRET })

    test('the server reports that it cannot hold keys', () => {
      expect(isCryptoConfigured()).toBe(false)
    })

    test('and says so rather than storing anything in the clear', () => {
      expect(() => encryptKey('sk-proj-abc')).toThrow(/KEY_ENCRYPTION_SECRET/)
    })
  })

  test('a secret shorter than 32 characters does not count as configured', () => {
    process.env.KEY_ENCRYPTION_SECRET = 'too-short'
    expect(isCryptoConfigured()).toBe(false)
  })
})

describe('keyHint', () => {
  test('shows enough to recognise the key and not enough to use it', () => {
    expect(keyHint('sk-proj-abcdefgh7Xb2')).toBe('sk-…7Xb2')
  })

  test('a short string gives nothing away', () => {
    expect(keyHint('sk-12')).toBe('…')
    expect(keyHint('')).toBe('…')
  })
})

describe('keysMatch', () => {
  test('matches equal keys and rejects different ones', () => {
    expect(keysMatch('sk-abc', 'sk-abc')).toBe(true)
    expect(keysMatch('sk-abc', 'sk-abd')).toBe(false)
    expect(keysMatch('sk-abc', 'sk-abcdef')).toBe(false)
    expect(keysMatch(null, undefined)).toBe(true)
  })
})
