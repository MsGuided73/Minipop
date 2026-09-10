// Throwaway visual harness for the node-card redesign. Mounts the real
// LensNode, SemanticEdge and EdgeMarkers on a real React Flow canvas with
// fixture data, so the card can be looked at without signing in.
// Delete once the redesign is settled.

import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Handle, Position } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../src/index.css'

import { CanvasProvider } from '../src/context/CanvasContext'
import LensNode from '../src/nodes/LensNode'
import SemanticEdge from '../src/components/SemanticEdge'
import EdgeMarkers from '../src/components/canvas/EdgeMarkers'

const SCRIPT = `# The $15K Myth — reverse-engineering documentary

Instead of showcasing five AI systems as solutions, this video deconstructs the
*real* value chain behind them. We open with the headline claim, then
systematically dismantle it — revealing that the build itself is nearly
worthless.

## Cold open

Hold on the claim for three seconds.

## Act one

Interview the contractors.

## Act two

Cut to the prompt solving it.
`

const GUIDE = `# PHASE 1 — THE SHORTLIST

## TRANSFORMATION & INVENTORY

This source delivers a single, powerful transformation: **from scattered, context-resetting AI workflows to a unified, persistent "AI team" that remembers everything, works autonomously, and adapts instantly to new models.**

The specific assets inside it are:

- **The One-Screen AI Team framework** — the core problem/solution model (five scattered tabs → one dashboard with shared memory)
- **Mission Control dashboard** — the central hub showing agent status, live activity, and unified access
- **The Obsidian vault system** — persistent, searchable memory that every agent reads from and writes to, eliminating re-explanation
- **Kanban board workflow** — tickets instead of prompts; dispatcher spawns workers while you're away
- **Goal Mode** — autonomous looping on a single objective for hours without user intervention
- **Model-swapping architecture** — new AI models plug in as "chips" without losing memory, workflows, or context
- **Specific numbers & examples**: 30-minute setup time, 3,800 businesses already using it

The source is **rich, specific, and actionable** — it's a complete system with named components, clear workflows, and real constraints. It's also *product-adjacent*: the creator already sells the Hermes Agent OS as a ready-made install.

---

## THREE PRODUCT PROPOSALS

### PRODUCT 1: "The One-Screen AI Team Blueprint"

**1) Name & Promise**

*The One-Screen AI Team Blueprint: Build Your 24/7 AI Command Center in One Weekend*

**2) Format & Scope**

Comprehensive written guide + 5 ready-to-use templates (Obsidian vault starter structure, Kanban board).

| Deliverable | Effort | Owner |
|---|---:|:---:|
| Vault starter | 2h | You |
| Kanban board | 1h | Claude |

> The build is nearly worthless. The sale is everything.

Install it with \`npm create hermes-os\`, then:

\`\`\`bash
hermes init --vault ./brain
hermes agents add researcher
\`\`\`

- [x] Framework extracted
- [ ] Templates drafted
`

function SourceNode({ data }) {
  return (
    <div
      style={{
        width: 270,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-card)',
        boxShadow: 'var(--shadow-card)',
        fontFamily: 'var(--font-ui)',
        color: 'var(--ink)',
      }}
    >
      <Handle type="source" position={Position.Bottom} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px 7px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-source)' }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--c-source)' }}>
          Source · YouTube
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, color: 'var(--ok)' }}>✓ Cached</span>
      </div>
      <div style={{ padding: '2px 12px 10px' }}>
        <h2 style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.35, margin: 0 }}>{data.label}</h2>
      </div>
    </div>
  )
}

const lens = (id, x, promptTitle, promptTags, doc) => ({
  id,
  type: 'lensNode',
  position: { x, y: 300 },
  style: { width: 270 },
  data: {
    label: doc ? doc.split('\n')[0].replace(/^#\s*/, '') : `${promptTitle} · 5 Client Systems`,
    promptTitle,
    promptTags,
    renderedPrompt: 'Read the transcript and produce the deliverable described above, in full.',
    messages: doc
      ? [{ role: 'user', content: 'kickoff', hidden: true }, { role: 'assistant', content: doc }]
      : [],
  },
})

const NODES = [
  { id: 'src', type: 'sourceNode', position: { x: 320, y: 40 }, style: { width: 270 }, data: { label: '5 Client Systems I One Shotted with Fable ($15k Value)' } },
  lens('script', 0, 'Viral Video Factory', ['script'], SCRIPT),
  lens('guide', 320, 'Comprehensive Course Builder', ['guide'], GUIDE),
  lens('notes', 640, 'Executive Summary', ['notes'], null),
]

const EDGES = ['script', 'guide', 'notes'].map(t => ({
  id: `e-src-${t}`, source: 'src', target: t, type: 'semantic', animated: true,
}))

const NODE_TYPES = { lensNode: LensNode, sourceNode: SourceNode }
const EDGE_TYPES = { semantic: SemanticEdge }

function Preview() {
  return (
    <CanvasProvider>
      <ReactFlowProvider>
        <div style={{ width: '100vw', height: '100vh', background: 'var(--ground)' }}>
          <EdgeMarkers />
          <ReactFlow
            defaultNodes={NODES}
            defaultEdges={EDGES}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="var(--dot)" />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </CanvasProvider>
  )
}

createRoot(document.getElementById('root')).render(<Preview />)
