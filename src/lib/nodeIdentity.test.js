import { describe, test, expect } from 'vitest'
import { identityFor, displayLabel, IDENTITIES } from './nodeIdentity'

describe('identityFor — source nodes', () => {
  test.each([
    'youtubeNode', 'mediaNode', 'documentNode', 'urlNode', 'textNode', 'transcriptNode',
  ])('%s is a source regardless of prompt', (nodeType) => {
    const id = identityFor({ nodeType, promptTitle: 'Viral Video Script' })
    expect(id.key).toBe('source')
    expect(id.color).toBe('var(--c-source)')
  })
})

describe('identityFor — tags win over titles', () => {
  test('a script tag beats a guide-sounding title', () => {
    expect(identityFor({ promptTitle: 'Course Tutorial', promptTags: ['script'] }).key).toBe('script')
  })

  test('tag matching is case-insensitive', () => {
    expect(identityFor({ promptTags: ['NOTES'] }).key).toBe('notes')
  })

  test('an unrecognised tag falls through to the title', () => {
    expect(identityFor({ promptTitle: 'Study Notes', promptTags: ['misc'] }).key).toBe('notes')
  })
})

describe('identityFor — titles', () => {
  test.each([
    ['Viral Video Factory', 'script'],
    ['Comprehensive Course Builder', 'guide'],
    ['Executive Summary', 'notes'],
  ])('%s → %s', (promptTitle, key) => {
    expect(identityFor({ promptTitle }).key).toBe(key)
  })

  test('the first matching rule wins, so a script beats a guide', () => {
    expect(identityFor({ promptTitle: 'Video script tutorial' }).key).toBe('script')
  })
})

describe('identityFor — fallback', () => {
  test('an unclassifiable prompt takes the accent, not an arbitrary hue', () => {
    const id = identityFor({ promptTitle: 'Peptide Marketing' })
    expect(id.key).toBe('default')
    expect(id.color).toBe('var(--accent)')
    expect(id.label).toBe('Peptide Marketing')
  })

  test('no input at all still returns a usable identity', () => {
    const id = identityFor()
    expect(id.color).toBe('var(--accent)')
    expect(id.label).toBe('Document')
  })
})

describe('displayLabel', () => {
  test('prefers the prompt title', () => {
    expect(displayLabel({ promptTitle: 'Viral Factory', identity: IDENTITIES.script })).toBe('Viral Factory')
  })

  test('falls back to the family name, then to Document', () => {
    expect(displayLabel({ identity: IDENTITIES.guide })).toBe('How-To Guide')
    expect(displayLabel({})).toBe('Document')
  })
})
