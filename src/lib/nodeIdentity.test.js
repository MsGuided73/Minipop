import { describe, test, expect } from 'vitest'
import { identityFor, displayLabel, shortLabel, IDENTITIES } from './nodeIdentity'

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

describe('identityFor — education is a subject, not a family', () => {
  test.each([
    ['Study Notes', ['notes', 'education'], 'notes'],
    ['Glossary & Key Terms', ['glossary', 'education', 'extraction'], 'notes'],
    ['Quiz & Flashcard Generator', ['quiz', 'education'], 'notes'],
    ['Comprehensive Course Builder', ['course', 'education', 'repurpose'], 'guide'],
  ])('%s → %s', (promptTitle, promptTags, key) => {
    expect(identityFor({ promptTitle, promptTags }).key).toBe(key)
  })
})

describe('shortLabel', () => {
  test.each([
    ['How-To Guide', 'How-To Guide'],
    ['Concept Explainer', 'Concept Explainer'],
    ['Comprehensive Course Builder', 'Comprehensive Course'],
    ['Action Plan & Checklist', 'Action Plan'],
    ['Executive Summary & Takeaways', 'Executive Summary'],
    ['Fact, Claim & Citation Extractor', 'Fact, Claim'],
    ['Tools, Resources & People Mentioned', 'Tools, Resources'],
    ['Quiz & Flashcard Generator', 'Quiz & Flashcard'],
    ['Social Media Content Pack', 'Social Media Content'],
    ['Tone, Bias & Audience Analysis', 'Tone, Bias'],
  ])('%s → %s', (title, expected) => {
    expect(shortLabel(title)).toBe(expected)
  })

  test('keeps the head and drops a subtitle', () => {
    expect(shortLabel('Action Plan: eight steps to ship')).toBe('Action Plan')
    expect(shortLabel('Study Notes — exhaustive')).toBe('Study Notes')
  })

  test('a single word past the cap is cut with an ellipsis, since it has no word boundary', () => {
    expect(shortLabel('Supercalifragilisticexpialidocious')).toBe('Supercalifragilisti…')
  })

  test('a two-word title keeps both words rather than stranding one', () => {
    expect(shortLabel('Concept Explainer')).toBe('Concept Explainer')
    expect(shortLabel('Reconciliation Walkthrough')).toBe('Reconciliation Walkthrough')
  })

  test('a first word past the cap is cut rather than paired with the next', () => {
    expect(shortLabel('Supercalifragilisticexpialidocious Explainer'))
      .toBe('Supercalifragilisti…')
  })

  test('an empty or blank title gives nothing to fall back from', () => {
    expect(shortLabel('')).toBe('')
    expect(shortLabel('   ')).toBe('')
  })
})

describe('identityFor — the badge names the prompt, not its family', () => {
  test.each([
    ['Comprehensive Course Builder', 'guide', 'Comprehensive Course'],
    ['Action Plan & Checklist', 'guide', 'Action Plan'],
    ['Study Notes', 'notes', 'Study Notes'],
    ['Alternate Video Script', 'script', 'Alternate Video'],
  ])('%s keeps the %s hue but is labelled %s', (promptTitle, key, label) => {
    const id = identityFor({ promptTitle })
    expect(id.key).toBe(key)
    expect(id.label).toBe(label)
  })

  test('only the How-To Guide prompt is labelled How-To Guide', () => {
    expect(identityFor({ promptTitle: 'How-To Guide', promptTags: ['guide', 'how-to'] }).label)
      .toBe('How-To Guide')
  })

  test('a node with no prompt yet falls back to the family name', () => {
    expect(identityFor({ promptTags: ['guide'] }).label).toBe('How-To Guide')
  })

  test('the family travels alongside the name, for the tag under it', () => {
    const id = identityFor({ promptTitle: 'Comprehensive Course Builder' })
    expect(id.label).toBe('Comprehensive Course')
    expect(id.family).toBe('How-To Guide')
  })

  test('an unclassified prompt has no family to tag', () => {
    expect(identityFor({ promptTitle: 'Peptide Marketing' }).family).toBeNull()
  })

  test('a source keeps its family name even if a prompt title is passed', () => {
    expect(identityFor({ nodeType: 'youtubeNode', promptTitle: 'Viral Video Script' }).label)
      .toBe('Source')
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
