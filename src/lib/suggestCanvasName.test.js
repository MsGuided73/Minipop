import { describe, test, expect } from 'vitest'
import { suggestCanvasName } from './suggestCanvasName'

const node = (type, data) => ({ type, data })

describe('suggestCanvasName', () => {
  test('returns empty for an empty canvas', () => {
    expect(suggestCanvasName([])).toBe('')
    expect(suggestCanvasName()).toBe('')
  })

  test('prefers a YouTube title over other sources', () => {
    const nodes = [
      node('textNode', { label: 'some scratch notes' }),
      node('youtubeNode', { label: '5 Client Systems I One Shotted with Fable' }),
    ]
    expect(suggestCanvasName(nodes)).toBe('5 Client Systems I One Shotted with Fable')
  })

  test('falls back down the priority list', () => {
    expect(suggestCanvasName([node('urlNode', { label: 'An article' })])).toBe('An article')
    expect(suggestCanvasName([node('textNode', { label: 'A note' })])).toBe('A note')
  })

  test('ignores a label that is just the node type', () => {
    // Nodes default data.label to their type name; that is not a title.
    expect(suggestCanvasName([node('youtubeNode', { label: 'youtubeNode' })])).toBe('')
  })

  test('strips creator noise from video titles', () => {
    expect(suggestCanvasName([node('youtubeNode', { label: 'Hermes Agent OS (Official Video)' })]))
      .toBe('Hermes Agent OS')
    expect(suggestCanvasName([node('youtubeNode', { label: '"Quoted Title"' })]))
      .toBe('Quoted Title')
  })

  test('drops a trailing channel suffix but keeps real content after a dash', () => {
    expect(suggestCanvasName([node('youtubeNode', { label: 'Sacred Geometry - Spirit Science TV' })]))
      .toBe('Sacred Geometry')
    // "reverse-engineering documentary" is the subject, not a channel — keep it.
    expect(suggestCanvasName([node('youtubeNode', { label: 'The $15K Myth - a documentary' })]))
      .toBe('The $15K Myth - a documentary')
  })

  test('truncates on a word boundary', () => {
    const long = 'A'.repeat(20) + ' ' + 'B'.repeat(20) + ' ' + 'C'.repeat(40)
    const out = suggestCanvasName([node('youtubeNode', { label: long })])
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('CCC')
  })

  test('uses title before label when both exist', () => {
    expect(suggestCanvasName([node('youtubeNode', { title: 'Real Title', label: 'fallback' })]))
      .toBe('Real Title')
  })
})
