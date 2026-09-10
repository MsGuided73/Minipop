import { describe, test, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LensNode from './LensNode'

// ── Mocks ────────────────────────────────────────────────────────────────────
// React Flow is stubbed the way PromptFillModal's tests stub it: the card's
// behaviour is what is under test, not the canvas that hosts it.

let graphNodes = []
let graphEdges = []
const setNodesMock = vi.fn()

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useNodes: () => graphNodes,
  useEdges: () => graphEdges,
  useReactFlow: () => ({
    getNodes: () => graphNodes,
    getEdges: () => graphEdges,
    getNode: (id) => graphNodes.find(n => n.id === id),
    setNodes: setNodesMock,
  }),
}))

const updateNodeMock = vi.fn()
const deleteNodeMock = vi.fn()

vi.mock('../context/CanvasContext', () => ({
  useCanvas: () => ({
    updateNode: (...args) => updateNodeMock(...args),
    deleteNode: (...args) => deleteNodeMock(...args),
    state: { apiKey: 'sk-test', model: 'gpt-4o', geminiKey: '', anthropicKey: '', autoContinue: false },
  }),
}))

const callLensChatMock = vi.fn()

vi.mock('../services/aiService', async (importActual) => {
  const actual = await importActual()
  return { ...actual, callLensChat: (...args) => callLensChatMock(...args) }
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LENS_ID = 'lens-1'
const SOURCE = { id: 'src-1', type: 'youtubeNode', position: { x: 0, y: 0 }, data: { label: '5 Client Systems' } }
const EDGE = { id: 'e1', source: 'src-1', target: LENS_ID }

const DOCUMENT = `# Build five AI client systems

Identify which automation a business needs, then write one prompt to build it.

## Step one

Diagnose before building.

## Step two

Ship the smallest thing that works.
`

function baseData(overrides = {}) {
  return {
    label: 'How-To Guide · 5 Client Systems',
    promptTitle: 'Comprehensive Course Builder',
    promptTags: ['guide'],
    promptBody: 'Analyse {{topic}}',
    renderedPrompt: 'Analyse the five systems in detail and produce a how-to guide.',
    values: {},
    ...overrides,
  }
}

function completedData(overrides = {}) {
  return baseData({
    messages: [
      { role: 'user', content: 'kickoff', hidden: true },
      { role: 'assistant', content: DOCUMENT },
    ],
    ...overrides,
  })
}

function renderCard(data, { connected = true } = {}) {
  graphNodes = [SOURCE, { id: LENS_ID, type: 'lensNode', position: { x: 0, y: 0 }, style: { width: 270 }, data }]
  graphEdges = connected ? [EDGE] : []
  return render(<LensNode id={LENS_ID} data={data} selected={false} />)
}

beforeEach(() => {
  updateNodeMock.mockReset()
  deleteNodeMock.mockReset()
  setNodesMock.mockReset()
  callLensChatMock.mockReset()
  callLensChatMock.mockResolvedValue(DOCUMENT)
})

// ── Before the first run ─────────────────────────────────────────────────────

describe('LensNode card — before a run', () => {
  test('shows the identity from the prompt tag, not the prompt title', () => {
    renderCard(baseData())
    // Tagged "guide", so it is a How-To Guide even though the title says Course.
    expect(screen.getByText('How-To Guide')).toBeInTheDocument()
  })

  test('is Ready with a source connected and offers to run', () => {
    renderCard(baseData())
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run/ })).toBeEnabled()
    expect(screen.getByText('1 source · Comprehensive Course Builder')).toBeInTheDocument()
  })

  test('previews the prompt that will run', () => {
    renderCard(baseData())
    expect(screen.getByText(/Analyse the five systems/)).toBeInTheDocument()
  })

  test('refuses to run with no source connected and says why', () => {
    renderCard(baseData(), { connected: false })
    expect(screen.getByText('No source')).toBeInTheDocument()
    const run = screen.getByRole('button', { name: /Run/ })
    expect(run).toBeDisabled()
    expect(run).toHaveAttribute('title', 'Connect a source node first')
  })

  test('running posts the kickoff and writes the reply back to the node', async () => {
    const user = userEvent.setup()
    renderCard(baseData({ autoLabel: true }))

    await user.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => expect(updateNodeMock).toHaveBeenCalled())
    const [nodeId, update] = updateNodeMock.mock.calls.at(-1)
    expect(nodeId).toBe(LENS_ID)
    expect(update.data.messages).toHaveLength(2)
    expect(update.data.messages[0].hidden).toBe(true)
    expect(update.data.messages[1]).toMatchObject({ role: 'assistant', content: DOCUMENT })
    // The document names the node, since nobody has renamed it by hand.
    expect(update.data.label).toBe('Build five AI client systems')
  })

  test('a hand-picked name is never overruled by the document', async () => {
    const user = userEvent.setup()
    renderCard(baseData({ autoLabel: false }))

    await user.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => expect(updateNodeMock).toHaveBeenCalled())
    expect(updateNodeMock.mock.calls.at(-1)[1].data).not.toHaveProperty('label')
  })

  test('surfaces a failed run on the card', async () => {
    const user = userEvent.setup()
    callLensChatMock.mockRejectedValue(new Error('No API key configured'))
    renderCard(baseData())

    await user.click(screen.getByRole('button', { name: /Run/ }))

    expect(await screen.findByText('No API key configured')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })
})

// ── After a run ──────────────────────────────────────────────────────────────

describe('LensNode card — with a document', () => {
  test('reports completion, a clamped preview and a derived count', () => {
    renderCard(completedData())
    expect(screen.getByText('✓ Complete')).toBeInTheDocument()
    expect(screen.getByText('1 source · 2 sections')).toBeInTheDocument()
    // Prose only — the preview is not a list of the document's headings.
    const preview = screen.getByText(/Identify which automation/)
    expect(preview).toBeInTheDocument()
    expect(preview.textContent).not.toContain('Step one')
  })

  test('offers Read rather than Run', () => {
    renderCard(completedData())
    expect(screen.getByRole('button', { name: /Read/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
  })
})

// ── The reader ───────────────────────────────────────────────────────────────

describe('LensNode → DocumentReader', () => {
  test('Read opens the document rendered, not raw', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: /Read/ }))

    const reader = await screen.findByRole('dialog')
    // Rendered: a real heading element, with no literal "#" left on screen.
    expect(within(reader).getByRole('heading', { name: 'Build five AI client systems' })).toBeInTheDocument()
    expect(reader.textContent).not.toContain('# Build five AI client systems')
    expect(within(reader).getByText(/from/)).toHaveTextContent('5 Client Systems')
  })

  test('closing the reader leaves the card behind', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: /Read/ }))
    await user.click(await screen.findByRole('button', { name: /Close reader/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Read/ })).toBeInTheDocument()
  })

  test('a follow-up posts into the node thread, keeping the document', async () => {
    const user = userEvent.setup()
    callLensChatMock.mockResolvedValue('Shortened.')
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: /Read/ }))
    const reader = await screen.findByRole('dialog')
    await user.type(within(reader).getByLabelText('Ask a follow-up'), 'Shorten step two')
    await user.click(within(reader).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(callLensChatMock).toHaveBeenCalled())
    // The follow-up is the user message, and prior turns are carried as history.
    const [, userMessage, , history] = callLensChatMock.mock.calls.at(-1)
    expect(userMessage).toBe('Shorten step two')
    expect(history).toHaveLength(2)

    await waitFor(() => expect(updateNodeMock).toHaveBeenCalled())
    const messages = updateNodeMock.mock.calls.at(-1)[1].data.messages
    expect(messages).toHaveLength(4)
    expect(messages[1].content).toBe(DOCUMENT)   // the document survives the follow-up
    expect(messages.at(-1).content).toBe('Shortened.')
  })

  test('a failed follow-up is shown in the reader and keeps the question', async () => {
    const user = userEvent.setup()
    callLensChatMock.mockRejectedValue(new Error('Rate limited'))
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: /Read/ }))
    const reader = await screen.findByRole('dialog')
    const input = within(reader).getByLabelText('Ask a follow-up')
    await user.type(input, 'Shorten step two')
    await user.click(within(reader).getByRole('button', { name: 'Send' }))

    // The backdrop hides the card, so the error has to appear in the drawer.
    expect(await within(reader).findByRole('alert')).toHaveTextContent('Rate limited')
    // And the question is still there to retry, not silently discarded.
    expect(input).toHaveValue('Shorten step two')
  })

  test('reopening within the exit window does not unmount the drawer', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    // Close then immediately reopen — the close scheduled an unmount that must
    // not fire now that the drawer is open again.
    await user.click(screen.getByRole('button', { name: /Read/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /Close reader/ }))
    await user.click(screen.getByRole('button', { name: /Read/ }))

    // Inside act, because the stale exit timer would otherwise settle outside it.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('clearing the document closes the reader rather than leaving it mounted', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: /Read/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    await user.click(screen.getByRole('button', { name: 'Clear document' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

// ── The ⋯ menu ───────────────────────────────────────────────────────────────

describe('LensNode card — node menu', () => {
  test('carries the actions the old node header carried', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    const menu = screen.getByRole('menu')
    for (const name of ['Rename', 'View prompt', 'Copy transcript', 'Save .md', 'Re-run original', 'Clear document', 'Delete node']) {
      expect(within(menu).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  test('renaming stops the document from renaming the node later', async () => {
    const user = userEvent.setup()
    renderCard(completedData({ autoLabel: true }))

    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'My guide{Enter}')

    expect(updateNodeMock).toHaveBeenCalledWith(LENS_ID, { data: { label: 'My guide', autoLabel: false } })
  })

  test('the prompt is read-only once a document exists', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    await user.click(screen.getByRole('button', { name: 'View prompt' }))

    expect(screen.getByText(/Analyse the five systems/, { selector: '.cl-card-prompt' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Rendered prompt')).not.toBeInTheDocument()
  })

  test('the prompt is editable before a run', async () => {
    const user = userEvent.setup()
    renderCard(baseData())

    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    await user.click(screen.getByRole('button', { name: 'Edit prompt' }))

    expect(screen.getByLabelText('Rendered prompt')).toBeInTheDocument()
  })

  test('delete removes the node', async () => {
    const user = userEvent.setup()
    renderCard(completedData())

    await user.click(screen.getByRole('button', { name: 'Node menu' }))
    await user.click(screen.getByRole('button', { name: 'Delete node' }))

    expect(deleteNodeMock).toHaveBeenCalledWith(LENS_ID)
  })
})

// ── Migration of pre-redesign nodes ──────────────────────────────────────────

describe('LensNode card — legacy sizing', () => {
  test('normalises a node still carrying the old 380x460 box', () => {
    graphNodes = [
      SOURCE,
      { id: LENS_ID, type: 'lensNode', position: { x: 0, y: 0 }, style: { width: 380, height: 460 }, data: completedData() },
    ]
    graphEdges = [EDGE]
    render(<LensNode id={LENS_ID} data={completedData()} selected={false} />)

    expect(setNodesMock).toHaveBeenCalled()
    const updated = setNodesMock.mock.calls[0][0](graphNodes).find(n => n.id === LENS_ID)
    expect(updated.style).toEqual({ width: 270 })
  })

  test('leaves an already-normalised node alone', () => {
    renderCard(completedData())
    expect(setNodesMock).not.toHaveBeenCalled()
  })
})
