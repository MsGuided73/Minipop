import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptFillModal from './PromptFillModal'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Keep the pure helpers real; only stub the network-backed calls.
const createPromptMock = vi.fn()
const suggestVariablesMock = vi.fn()

vi.mock('../services/promptService', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    createPrompt: (...args) => createPromptMock(...args),
    suggestVariables: (...args) => suggestVariablesMock(...args),
  }
})

vi.mock('../context/CanvasContext', () => ({
  useCanvas: () => ({ state: { apiKey: 'sk-test', model: 'gpt-4o', geminiKey: '' } }),
}))

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ getNodes: () => [], getEdges: () => [] }),
}))

const BLANK_PROMPT = { id: null, title: '', body: '', description: '', tags: [], variables: [] }

beforeEach(() => {
  createPromptMock.mockReset()
  suggestVariablesMock.mockReset()
  createPromptMock.mockResolvedValue({ id: 'new-1' })
})

// ── Create-new mode ──────────────────────────────────────────────────────────
describe('PromptFillModal — create-new mode', () => {
  test('renders the New Prompt editor with an empty title and a Create button', () => {
    render(<PromptFillModal prompt={BLANK_PROMPT} isCreateNew onClose={vi.fn()} onRefreshLibrary={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'New Prompt' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('My new prompt')).toHaveValue('')
    expect(screen.getByRole('button', { name: /create prompt/i })).toBeInTheDocument()
    // The variable-fill flow must not be shown in editor mode.
    expect(screen.queryByRole('button', { name: /spawn lens node/i })).not.toBeInTheDocument()
  })

  test('saves a new prompt without a parentId and refreshes + closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRefreshLibrary = vi.fn()
    render(<PromptFillModal prompt={BLANK_PROMPT} isCreateNew onClose={onClose} onRefreshLibrary={onRefreshLibrary} />)

    await user.type(screen.getByPlaceholderText('My new prompt'), 'Hook Analyzer')
    await user.type(screen.getByPlaceholderText('analysis, monetization, custom'), 'analysis, hooks')
    // userEvent treats `{` as a special-key prefix; `{{` types one literal `{`,
    // so each brace in the template body must be doubled.
    await user.type(
      screen.getByPlaceholderText('Use {{variable_name}} for templated fields'),
      'Analyze the {{video_type}} hook.'.replace(/\{/g, '{{')
    )

    await user.click(screen.getByRole('button', { name: /create prompt/i }))

    await waitFor(() => expect(createPromptMock).toHaveBeenCalledTimes(1))
    const payload = createPromptMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      title: 'Hook Analyzer',
      body: 'Analyze the {{video_type}} hook.',
      tags: ['analysis', 'hooks'],
    })
    expect(payload).not.toHaveProperty('parentId')
    expect(onRefreshLibrary).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('blocks saving with an empty title', async () => {
    const user = userEvent.setup()
    render(<PromptFillModal prompt={BLANK_PROMPT} isCreateNew onClose={vi.fn()} onRefreshLibrary={vi.fn()} />)

    await user.type(
      screen.getByPlaceholderText('Use {{variable_name}} for templated fields'),
      'Some body'
    )
    await user.click(screen.getByRole('button', { name: /create prompt/i }))

    expect(await screen.findByText('Title is required.')).toBeInTheDocument()
    expect(createPromptMock).not.toHaveBeenCalled()
  })

  test('blocks saving with an empty body', async () => {
    const user = userEvent.setup()
    render(<PromptFillModal prompt={BLANK_PROMPT} isCreateNew onClose={vi.fn()} onRefreshLibrary={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('My new prompt'), 'Titled but bodiless')
    await user.click(screen.getByRole('button', { name: /create prompt/i }))

    expect(await screen.findByText('Prompt body is required.')).toBeInTheDocument()
    expect(createPromptMock).not.toHaveBeenCalled()
  })
})

// ── Save-as-variation mode ───────────────────────────────────────────────────
describe('PromptFillModal — save-as-variation mode', () => {
  const PARENT = {
    id: 'parent-1',
    title: 'Forensic Analyst',
    body: 'Examine {{video_type}}',
    description: 'desc',
    tags: ['analysis'],
    variables: [],
  }

  test('prefills a suggested variation title and sends parentId on save', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PromptFillModal prompt={PARENT} isSaveAsVariation onClose={onClose} onRefreshLibrary={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Save as Variation' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('My customized variation')).toHaveValue('Forensic Analyst (custom)')

    await user.click(screen.getByRole('button', { name: /save variation/i }))

    await waitFor(() => expect(createPromptMock).toHaveBeenCalledTimes(1))
    expect(createPromptMock.mock.calls[0][0]).toMatchObject({
      title: 'Forensic Analyst (custom)',
      body: 'Examine {{video_type}}',
      parentId: 'parent-1',
    })
    expect(onClose).toHaveBeenCalled()
  })
})

// ── Default fill-and-spawn mode ──────────────────────────────────────────────
describe('PromptFillModal — fill-and-spawn mode', () => {
  const PROMPT = {
    id: 'p-1',
    title: 'Quick Lens',
    body: 'Look at {{video_type}}',
    variables: [],
  }

  test('does not render the editor and spawns a lens node on submit', async () => {
    const user = userEvent.setup()
    const onSpawnLensNode = vi.fn()
    const onClose = vi.fn()
    render(<PromptFillModal prompt={PROMPT} onClose={onClose} onSpawnLensNode={onSpawnLensNode} />)

    expect(screen.getByRole('heading', { name: 'Use: Quick Lens' })).toBeInTheDocument()
    // No editor title field in this mode.
    expect(screen.queryByPlaceholderText('My new prompt')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('My customized variation')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /spawn lens node/i }))

    await waitFor(() => expect(onSpawnLensNode).toHaveBeenCalledTimes(1))
    expect(onSpawnLensNode.mock.calls[0][0]).toMatchObject({
      promptId: 'p-1',
      promptTitle: 'Quick Lens',
      promptBody: 'Look at {{video_type}}',
    })
    expect(createPromptMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
