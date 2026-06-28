// Shared catalog of selectable AI models. Single source of truth for the
// Settings panel and the toolbar quick-switcher so the two never drift.
//
// Keep ids in sync with VALID_MODELS in context/CanvasContext.jsx and the
// provider routing in services/aiService.js (getProvider).

export const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o', desc: 'OpenAI Omni — fast and intelligent', recommended: true },
  { id: 'o1-preview', label: 'o1 Preview', desc: 'OpenAI reasoning model' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', desc: 'Anthropic — fast, capable, cost-efficient' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', desc: 'Google open model — max quality (256K context)' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (MoE)', desc: 'Google open model — faster, cheaper, similar quality' },
]

// Convenience lookup: model id → display label (falls back to the id itself).
export function modelLabel(id) {
  return MODELS.find(m => m.id === id)?.label || id
}
