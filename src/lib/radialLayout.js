// Radial auto-layout: keeps one node where it is and arranges every other node
// on concentric rings around it, ring N holding the nodes N hops away.
//
// Pure — takes nodes/edges, returns new top-left positions. Nothing is mutated.

const DEFAULT_WIDTH = 280
const DEFAULT_HEIGHT = 200
const GAP = 48
// Screens are wider than tall, so rings are ellipses rather than circles.
const ASPECT = 1.5
const MAX_GROWTH_STEPS = 24
const GROWTH_FACTOR = 1.08

export function nodeSize(node) {
  return {
    width: node.measured?.width || node.width || node.style?.width || DEFAULT_WIDTH,
    height: node.measured?.height || node.height || node.style?.height || DEFAULT_HEIGHT,
  }
}

function centerOf(node) {
  const { width, height } = nodeSize(node)
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 }
}

/** The node that has the most connections — the natural hub of a canvas. */
export function pickRoot(nodes, edges) {
  const selected = nodes.find(n => n.selected && !n.parentId)
  if (selected) return selected.id
  const degree = new Map()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1)
    degree.set(e.target, (degree.get(e.target) || 0) + 1)
  }
  let best = null
  for (const n of nodes) {
    if (n.parentId) continue
    if (!best || (degree.get(n.id) || 0) > (degree.get(best.id) || 0)) best = n
  }
  return best ? best.id : null
}

/** Hop distance from the root over undirected edges. Unreached nodes are absent. */
function hopDistances(rootId, ids, edges) {
  const adjacent = new Map(ids.map(id => [id, []]))
  for (const e of edges) {
    if (adjacent.has(e.source) && adjacent.has(e.target)) {
      adjacent.get(e.source).push(e.target)
      adjacent.get(e.target).push(e.source)
    }
  }
  const distance = new Map([[rootId, 0]])
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()
    for (const next of adjacent.get(current)) {
      if (!distance.has(next)) {
        distance.set(next, distance.get(current) + 1)
        queue.push(next)
      }
    }
  }
  return distance
}

function overlaps(a, b) {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + GAP / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + GAP / 2
  )
}

/** Boxes (center + size) for one ring at the given radius, evenly spaced by size. */
function placeRing(members, radius, origin, startAngle) {
  const spans = members.map(m => Math.max(m.width, m.height) + GAP)
  const total = spans.reduce((sum, s) => sum + s, 0)
  let angle = startAngle
  return members.map((m, i) => {
    const share = (spans[i] / total) * Math.PI * 2
    const mid = angle + share / 2
    angle += share
    return {
      ...m,
      x: origin.x + Math.cos(mid) * radius * ASPECT,
      y: origin.y + Math.sin(mid) * radius,
    }
  })
}

function hasOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) return true
    }
  }
  return false
}

/**
 * @param {Array} nodes React Flow nodes
 * @param {Array} edges React Flow edges
 * @param {string} [rootId] node to keep fixed; defaults to the selected / most-connected node
 * @returns {Map<string, {x: number, y: number}>} new top-left position per moved node
 */
export function radialLayout(nodes, edges, rootId) {
  // Children of a group move with the group, so they are not laid out themselves.
  const movable = nodes.filter(n => !n.parentId)
  const root = movable.find(n => n.id === (rootId ?? pickRoot(movable, edges)))
  if (!root) return new Map()

  const origin = centerOf(root)
  const distance = hopDistances(root.id, movable.map(n => n.id), edges)
  const outermost = Math.max(0, ...distance.values())

  // Rings by hop count; nodes with no path to the root form one last ring.
  const rings = new Map()
  for (const n of movable) {
    if (n.id === root.id) continue
    const ring = distance.has(n.id) ? distance.get(n.id) : outermost + 1
    if (!rings.has(ring)) rings.set(ring, [])
    const { width, height } = nodeSize(n)
    const c = centerOf(n)
    rings.get(ring).push({
      id: n.id,
      width,
      height,
      // Sorting by current angle keeps the user's rough arrangement.
      angle: Math.atan2(c.y - origin.y, (c.x - origin.x) / ASPECT),
    })
  }

  const rootSize = nodeSize(root)
  let innerEdge = Math.hypot(rootSize.width, rootSize.height) / 2
  const result = new Map()

  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    const members = rings.get(ring).sort((a, b) => a.angle - b.angle)
    const reach = Math.max(...members.map(m => Math.hypot(m.width, m.height) / 2))
    const startAngle = members[0].angle

    let radius = innerEdge + reach + GAP
    let placed = placeRing(members, radius, origin, startAngle)
    for (let step = 0; step < MAX_GROWTH_STEPS && hasOverlap(placed); step++) {
      radius *= GROWTH_FACTOR
      placed = placeRing(members, radius, origin, startAngle)
    }

    for (const box of placed) {
      result.set(box.id, { x: box.x - box.width / 2, y: box.y - box.height / 2 })
    }
    innerEdge = radius + reach
  }
  return result
}
