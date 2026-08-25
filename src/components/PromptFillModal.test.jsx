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

// ── Saving the filled-in answers from the fill flow ──────────────────────────
describe('PromptFillModal — save answers as a prompt', () => {
  const PROMPT = {
    id: 'p-2',
    title: 'How-To Guide',
    body: 'Write for {{target_audience}} at {{depth_level}} depth.',
    description: 'A guide',
    tags: ['guide'],
    variables: [
      { name: 'target_audience', label: 'Audience', type: 'text', default: 'general readers' },
      { name: 'depth_level', label: 'Depth', type: 'select', default: 'exhaustive', options: ['standard', 'exhaustive'] },
    ],
  }

  test('offers a save control seeded with a suggested title', () => {
    render(<PromptFillModal prompt={PROMPT} onClose={vi.fn()} onSpawnLensNode={vi.fn()} />)

    expect(screen.getByPlaceholderText('Name your saved version')).toHaveValue('How-To Guide (custom)')
    expect(screen.getByRole('button', { name: /save prompt/i })).toBeInTheDocument()
    // Spawning stays the primary action — saving must not replace it.
    expect(screen.getByRole('button', { name: /spawn lens node/i })).toBeInTheDocument()
  })

  test('promotes the edited field answers to variable defaults and keeps the modal open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRefreshLibrary = vi.fn()
    render(
      <PromptFillModal
        prompt={PROMPT}
        onClose={onClose}
        onSpawnLensNode={vi.fn()}
        onRefreshLibrary={onRefreshLibrary}
      />
    )

    // The whole point: edit a field first, then save.
    const audience = screen.getByDisplayValue('general readers')
    await user.clear(audience)
    await user.type(audience, 'burned-out ER nurses')

    await user.click(screen.getByRole('button', { name: /save prompt/i }))

    await waitFor(() => expect(createPromptMock).toHaveBeenCalledTimes(1))
    const payload = createPromptMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      title: 'How-To Guide (custom)',
      body: 'Write for {{target_audience}} at {{depth_level}} depth.',
      tags: ['guide'],
      parentId: 'p-2',
    })
    // The typed answer becomes the new default; untouched fields keep theirs.
    expect(payload.variables).toEqual([
      expect.objectContaining({ name: 'target_audience', default: 'burned-out ER nurses' }),
      expect.objectContaining({ name: 'depth_level', default: 'exhaustive' }),
    ])
    expect(onRefreshLibrary).toHaveBeenCalledTimes(1)
    // Saving is not spawning — the user may still want to run it.
    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByText(/Saved "How-To Guide \(custom\)" to the library\./)).toBeInTheDocument()
  })

  test('blocks saving without a title', async () => {
    const user = userEvent.setup()
    render(<PromptFillModal prompt={PROMPT} onClose={vi.fn()} onSpawnLensNode={vi.fn()} />)

    await user.clear(screen.getByPlaceholderText('Name your saved version'))
    // An empty title disables the button outright, so nothing can be sent.
    expect(screen.getByRole('button', { name: /save prompt/i })).toBeDisabled()
    expect(createPromptMock).not.toHaveBeenCalled()
  })

  test('is hidden for a prompt with no variables — there are no answers to save', () => {
    render(
      <PromptFillModal
        prompt={{ id: 'p-3', title: 'Static', body: 'No variables here.', variables: [] }}
        onClose={vi.fn()}
        onSpawnLensNode={vi.fn()}
      />
    )

    expect(screen.queryByPlaceholderText('Name your saved version')).not.toBeInTheDocument()
  })
})
