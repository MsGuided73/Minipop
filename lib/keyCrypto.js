// Encryption for the API keys users bring with them.
//
// The threat this is built for is a database dump: rows leak far more often
// than server environments do, and a row here is somebody's OpenAI billing.
// So the key that decrypts these rows lives only in the server environment
// (KEY_ENCRYPTION_SECRET) and never in Postgres — a dump on its own is noise.
//
// AES-256-GCM, which authenticates as well as encrypts: a tampered ciphertext
// fails to decrypt rather than silently producing a different key. Each record
// gets its own random IV, so two users with the same key do not produce the
// same row.
//
// What this does NOT protect against, stated plainly so nobody assumes
// otherwise: anyone who can read the server's environment can decrypt every
// key in the table. That is the trade for being able to make calls on the
// user's behalf at all.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12   // 96 bits, the size GCM is defined for
const KEY_BYTES = 32  // 256 bits

// A fixed salt is acceptable here and not a password-hashing mistake: this
// derives one server-wide key from one high-entropy secret, so there is no
// rainbow table to build and nothing gained by making the derivation per-row.
const SALT = 'contentloom.user-api-keys.v1'

let cachedSecret = null
let cachedKey = null

/**
 * The derived encryption key, or null when the server has no secret configured.
 * Derivation is cached because scrypt is deliberately slow and the secret does
 * not change while the process is alive.
 */
function encryptionKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  if (!secret || secret.length < 32) return null
  if (secret !== cachedSecret) {
    cachedKey = scryptSync(secret, SALT, KEY_BYTES)
    cachedSecret = secret
  }
  return cachedKey
}

/** Whether this server can store and read user keys at all. */
export function isCryptoConfigured() {
  return encryptionKey() !== null
}

/**
 * @param {string} plaintext
 * @returns {{ciphertext: string, iv: string, tag: string}} all base64
 */
export function encryptKey(plaintext) {
  const key = requireKey()
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new Error('Nothing to encrypt')
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

/**
 * @param {{ciphertext: string, iv: string, tag: string}} record
 * @returns {string} the original key
 * @throws if the record was tampered with, or the secret has changed
 */
export function decryptKey({ ciphertext, iv, tag }) {
  const key = requireKey()
  if (!ciphertext || !iv || !tag) throw new Error('Stored key is incomplete')

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Either the row was altered or KEY_ENCRYPTION_SECRET is not the one that
    // wrote it. Both mean "ask the user for their key again", and neither is
    // worth leaking detail about.
    throw new Error('Stored key could not be decrypted')
  }
}

/**
 * The only part of a key that is ever safe to show or log: enough to recognise
 * which key is saved, not enough to use it.
 * @param {string} plaintext
 * @returns {string} e.g. "sk-…7Xb2"
 */
export function keyHint(plaintext) {
  const key = String(plaintext || '')
  if (key.length <= 8) return '…'
  const prefix = key.slice(0, 3)
  return `${prefix}…${key.slice(-4)}`
}

/**
 * Constant-time comparison, for anywhere a key is checked rather than used.
 * Length is not secret here, so an early return on it is fine.
 */
export function keysMatch(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8')
  const right = Buffer.from(String(b || ''), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function requireKey() {
  const key = encryptionKey()
  if (!key) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET is not set (or is shorter than 32 characters), ' +
      'so user API keys cannot be stored or read.'
    )
  }
  return key
}
