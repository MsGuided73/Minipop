import { describe, it, expect } from 'vitest'
import { tokenize, similarity, nearMisses } from './near-miss.mjs'

// The name the build reads, in every test below.
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const TARGET = 'VITE_SUPABASE_ANON_KEY'

describe('tokenize', () => {
  it('splits on underscores and upper-cases', () => {
    expect(tokenize('vite_supabase_anon_key')).toEqual(['VITE', 'SUPABASE', 'ANON', 'KEY'])
  })

  it('treats any non-alphanumeric run as a separator', () => {
    expect(tokenize('VITE-SUPABASE.ANON  KEY')).toEqual(['VITE', 'SUPABASE', 'ANON', 'KEY'])
  })

  it('drops empty segments from leading, trailing and doubled separators', () => {
    expect(tokenize('__VITE__KEY__')).toEqual(['VITE', 'KEY'])
  })

  it('returns an empty list for empty and nullish input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(undefined)).toEqual([])
    expect(tokenize(null)).toEqual([])
  })
})

describe('similarity', () => {
  it('scores 1 for names differing only in case or separator', () => {
    expect(similarity(TARGET, 'vite_supabase_anon_key')).toBe(1)
    expect(similarity(TARGET, 'VITE-SUPABASE-ANON-KEY')).toBe(1)
  })

  it('scores an inserted word high — the failure this module exists for', () => {
    // Arrange: the real deploy failure. Character edit distance here is 7.
    const present = 'VITE_SUPABASE_ANON_PUBLIC_KEY'

    // Act
    const score = similarity(TARGET, present)

    // Assert: one extra word out of five, weighted by length.
    expect(score).toBeGreaterThan(0.7)
  })

  it('scores a dropped prefix high', () => {
    // The other likely mistake: setting the server-side name only.
    expect(similarity(TARGET, 'SUPABASE_ANON_KEY')).toBeGreaterThan(0.7)
  })

  it('scores a misspelled word high', () => {
    expect(similarity('VITE_SUPABASE_URL', 'VITE_SUPBASE_URL')).toBeGreaterThan(0.8)
  })

  it('keeps two required names apart even though they share two words', () => {
    // Both start VITE_SUPABASE_, so a character-level metric rates these close.
    // ANON, KEY and URL all go unmatched, which is what pulls the score down.
    expect(similarity(TARGET, 'VITE_SUPABASE_URL')).toBeLessThan(0.6)
  })

  it('scores unrelated names near zero', () => {
    expect(similarity(TARGET, 'APIFY_API_TOKEN')).toBeLessThan(0.2)
    expect(similarity(TARGET, 'COOLIFY_RESOURCE_UUID')).toBeLessThan(0.2)
    expect(similarity(TARGET, 'PATH')).toBeLessThan(0.2)
  })

  it('is symmetric', () => {
    const a = similarity(TARGET, 'VITE_SUPABASE_ANON_PUBLIC_KEY')
    const b = similarity('VITE_SUPABASE_ANON_PUBLIC_KEY', TARGET)
    expect(a).toBe(b)
  })

  it('scores 0 when either name has no words', () => {
    expect(similarity(TARGET, '')).toBe(0)
    expect(similarity('', TARGET)).toBe(0)
    expect(similarity('___', TARGET)).toBe(0)
  })
})

describe('nearMisses', () => {
  it('names the variable that actually held the value', () => {
    // Arrange: the environment as Coolify presented it at 18:56.
    const available = [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_PUBLIC_KEY',
      'SUPABASE_URL',
      'SUPABASE_ANON_PUBLIC_KEY',
      'APIFY_API_TOKEN',
      'COOLIFY_URL',
      'COOLIFY_FQDN',
      'COOLIFY_BRANCH',
      'COOLIFY_RESOURCE_UUID',
      'PATH',
      'HOSTNAME',
      'npm_package_name',
    ]

    // Act
    const suggestions = nearMisses(TARGET, available, { exclude: REQUIRED })

    // Assert
    expect(suggestions[0]).toBe('VITE_SUPABASE_ANON_PUBLIC_KEY')
  })

  it('excludes names the build already reads', () => {
    const suggestions = nearMisses(TARGET, REQUIRED, { exclude: REQUIRED })
    expect(suggestions).toEqual([])
  })

  it('never suggests the missing name itself', () => {
    const suggestions = nearMisses(TARGET, [TARGET])
    expect(suggestions).toEqual([])
  })

  it('returns nothing when no candidate resembles the target', () => {
    const suggestions = nearMisses(TARGET, ['PATH', 'HOME', 'NODE_ENV', 'APIFY_API_TOKEN'])
    expect(suggestions).toEqual([])
  })

  it('orders by score, best first', () => {
    const suggestions = nearMisses(TARGET, [
      'SUPABASE_ANON_PUBLIC_KEY',
      'VITE_SUPABASE_ANON_PUBLIC_KEY',
    ])
    expect(suggestions).toEqual([
      'VITE_SUPABASE_ANON_PUBLIC_KEY',
      'SUPABASE_ANON_PUBLIC_KEY',
    ])
  })

  it('caps the list so a noisy environment cannot bury the message', () => {
    const available = [
      'VITE_SUPABASE_ANON_PUBLIC_KEY',
      'SUPABASE_ANON_PUBLIC_KEY',
      'SUPABASE_ANON_KEY',
      'VITE_SUPABASE_ANON_KEY_2',
      'VITE_ANON_KEY',
    ]
    expect(nearMisses(TARGET, available).length).toBeLessThanOrEqual(3)
    expect(nearMisses(TARGET, available, { limit: 1 })).toHaveLength(1)
  })

  it('de-duplicates candidates', () => {
    const dupes = ['VITE_SUPABASE_ANON_PUBLIC_KEY', 'VITE_SUPABASE_ANON_PUBLIC_KEY']
    expect(nearMisses(TARGET, dupes)).toEqual(['VITE_SUPABASE_ANON_PUBLIC_KEY'])
  })

  it('finds a case-only mismatch for its own required name', () => {
    // VITE_SUPABASE_URL is in `exclude` because the build reads it, but the
    // lower-case spelling that was actually set must still be offered.
    const suggestions = nearMisses('VITE_SUPABASE_URL', ['vite_supabase_url'], {
      exclude: REQUIRED,
    })
    expect(suggestions).toEqual(['vite_supabase_url'])
  })
})
