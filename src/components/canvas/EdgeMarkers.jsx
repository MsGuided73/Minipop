import React from 'react'

/**
 * Arrowhead definitions for canvas edges, one per node identity.
 *
 * SVG marker references resolve by id across the whole document, so these live
 * in a single zero-size svg rather than being redefined by every edge. Each
 * marker fills from the identity's CSS variable, so the arrowheads follow the
 * theme — including the legacy palettes — with no JavaScript.
 *
 * Ported from the Node Redesign mockup's <marker> defs.
 */

const MARKERS = [
  ['cl-arrow-source', 'var(--c-source)'],
  ['cl-arrow-script', 'var(--c-script)'],
  ['cl-arrow-guide', 'var(--c-guide)'],
  ['cl-arrow-notes', 'var(--c-notes)'],
  ['cl-arrow-default', 'var(--accent)'],
]

export default function EdgeMarkers() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      style={{ position: 'absolute', pointerEvents: 'none' }}
    >
      <defs>
        {MARKERS.map(([id, fill]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill={fill} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}
