import { describe, test, expect } from 'vitest'
import { radialLayout, pickRoot, nodeSize } from './radialLayout'

const node = (id, x = 0, y = 0, extra = {}) => ({
  id,
  position: { x, y },
  measured: { width: 270, height: 180 },
  ...extra,
})
const edge = (source, target) => ({ id: `${source}-${target}`, source, target })

function boxes(nodes, positions) {
  return nodes.map(n => {
    const { width, height } = nodeSize(n)
    const p = positions.get(n.id) || n.position
    return { id: n.id, left: p.x, top: p.y, right: p.x + width, bottom: p.y + height }
  })
}

function anyOverlap(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return true
    }
  }
  return false
}

describe('radialLayout', () => {
  test('returns nothing for an empty canvas', () => {
    expect(radialLayout([], []).size).toBe(0)
  })

  test('never moves the root', () => {
    const nodes = [node('hub', 500, 300), node('a'), node('b')]
    const edges = [edge('hub', 'a'), edge('hub', 'b')]
    const positions = radialLayout(nodes, edges, 'hub')
    expect(positions.has('hub')).toBe(false)
  })

  test('twelve children of one source end up with no overlaps', () => {
    const hub = node('hub', 500, 300, { measured: { width: 320, height: 260 } })
    const kids = Array.from({ length: 12 }, (_, i) => node(`k${i}`, 520, 320))
    const nodes = [hub, ...kids]
    const edges = kids.map(k => edge('hub', k.id))
    const positions = radialLayout(nodes, edges)
    expect(anyOverlap(boxes(nodes, positions))).toBe(false)
  })

  test('second-hop nodes sit farther out than first-hop nodes', () => {
    const nodes = [node('hub'), node('a'), node('b')]
    const edges = [edge('hub', 'a'), edge('a', 'b')]
    const positions = radialLayout(nodes, edges, 'hub')
    const distance = id => {
      const p = positions.get(id)
      return Math.hypot(p.x - 0, p.y - 0)
    }
    expect(distance('b')).toBeGreaterThan(distance('a'))
  })

  test('nodes with no connection to the root are still placed', () => {
    const nodes = [node('hub'), node('a'), node('loner')]
    const positions = radialLayout(nodes, [edge('hub', 'a')], 'hub')
    expect(positions.has('loner')).toBe(true)
    expect(anyOverlap(boxes(nodes, positions))).toBe(false)
  })

  test('children of a group are left for the group to carry', () => {
    const nodes = [node('hub'), node('inside', 10, 10, { parentId: 'g' })]
    const positions = radialLayout(nodes, [], 'hub')
    expect(positions.has('inside')).toBe(false)
  })

  test('does not mutate the input nodes', () => {
    const nodes = [node('hub', 5, 5), node('a', 9, 9)]
    const snapshot = JSON.stringify(nodes)
    radialLayout(nodes, [edge('hub', 'a')], 'hub')
    expect(JSON.stringify(nodes)).toBe(snapshot)
  })
})

describe('pickRoot', () => {
  test('prefers the selected node', () => {
    const nodes = [node('a'), node('b', 0, 0, { selected: true })]
    expect(pickRoot(nodes, [])).toBe('b')
  })

  test('otherwise picks the most connected node', () => {
    const nodes = [node('a'), node('hub'), node('c')]
    expect(pickRoot(nodes, [edge('hub', 'a'), edge('hub', 'c')])).toBe('hub')
  })
})

describe('radialLayout compactness', () => {
  test('a handful of children stay close to the centre card', () => {
    const hub = node('hub', 0, 0, { measured: { width: 320, height: 260 } })
    const kids = Array.from({ length: 5 }, (_, i) => node(`k${i}`, 900 * i, -700))
    const nodes = [hub, ...kids]
    const positions = radialLayout(nodes, kids.map(k => edge('hub', k.id)), 'hub')
    for (const k of kids) {
      const p = positions.get(k.id)
      const gapX = Math.max(0, Math.abs(p.x + 135 - 160) - 135 - 160)
      const gapY = Math.max(0, Math.abs(p.y + 90 - 130) - 90 - 130)
      // Edge-to-edge distance from the centre card, not centre-to-centre.
      expect(Math.hypot(gapX, gapY)).toBeLessThan(120)
    }
    expect(anyOverlap(boxes(nodes, positions))).toBe(false)
  })
})
