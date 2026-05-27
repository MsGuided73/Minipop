// src/services/promptService.js
//
// Prompt Library service: REST wrappers, variable parsing, rendering, AI-assisted
// variable suggestion. The library is stored on Supabase via /api/v1/prompts.

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

// ─── Variable parsing & rendering ───────────────────────────────────────────

export function extractVariables(body) {
  if (!body) return []
  const names = new Set()
  let m
  while ((m = VARIABLE_RE.exec(body)) !== null) names.add(m[1])
  return [...names]
}

export function renderPrompt(body, values = {}) {
  if (!body) return ''
  return body.replace(VARIABLE_RE, (_, name) => {
    const v = values[name]
    return v == null || v === '' ? `{{${name}}}` : String(v)
  })
}

// Reconcile declared variable definitions with what's actually in the body.
// Returns a list of {name, label, description, default, type, options, autofill_source}
// in the order they appear in the body; any extras in `declared` get appended.
export function reconcileVariables(body, declared = []) {
  const inBody = extractVariables(body)
  const byName = Object.fromEntries(declared.map(v => [v.name, v]))
  const ordered = inBody.map(name => byName[name] || { name, label: humanize(name), type: 'text', default: '' })
  // Append declared vars that aren't in the body (rare but possible — e.g. legacy)
  declared.forEach(v => { if (!inBody.includes(v.name)) ordered.push(v) })
  return ordered
}

function humanize(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Autofill from connected node context ────────────────────────────────────

const NODE_TYPE_TO_VIDEO_TYPE = {
  youtubeNode: 'YouTube video',
  mediaNode: 'Media (image/video file)',
  documentNode: 'Document or PDF',
  textNode: 'Notes',
  urlNode: 'Article or blog',
}

// Given a target node (e.g. a freshly created Lens Node) and the full graph,
// return a values map pre-filled from the source nodes connected to it.
// Only fills variables whose `autofill_source` declares a known strategy.
export function buildAutofillValues(targetNodeId, nodes, edges, variableDefs) {
  const connectedIds = edges
    .filter(e => e.source === targetNodeId || e.target === targetNodeId)
    .map(e => (e.source === targetNodeId ? e.target : e.source))

  const sourceNodes = nodes.filter(n => connectedIds.includes(n.id))

  const values = {}
  for (const def of variableDefs || []) {
    if (def.autofill_source === 'connected_node_type' && sourceNodes.length > 0) {
      // If multiple connected sources, use the most specific (first non-text)
      const primary = sourceNodes.find(n => NODE_TYPE_TO_VIDEO_TYPE[n.type]) || sourceNodes[0]
      const mapped = NODE_TYPE_TO_VIDEO_TYPE[primary.type]
      if (mapped) values[def.name] = mapped
    }
  }
  return values
}

// Pick a sensible single-source label for the Lens node title (e.g. "Forensic Analyst · Spirit Science")
export function pickPrimarySourceLabel(targetNodeId, nodes, edges) {
  const connectedIds = edges
    .filter(e => e.source === targetNodeId || e.target === targetNodeId)
    .map(e => (e.source === targetNodeId ? e.target : e.source))
  const sourceNodes = nodes.filter(n => connectedIds.includes(n.id))
  if (sourceNodes.length === 0) return null
  const primary = sourceNodes.find(n => n.type === 'youtubeNode') || sourceNodes[0]
  return primary?.data?.label || null
}

// ─── REST API wrappers ───────────────────────────────────────────────────────

async function parseError(res, fallback) {
  const body = await res.json().catch(() => ({}))
  const parts = [body.error || fallback, body.detail].filter(Boolean)
  return new Error(`${parts.join(' — ')} (HTTP ${res.status})`)
}

export async function listPrompts(tag = null) {
  const url = tag ? `/api/v1/prompts?tag=${encodeURIComponent(tag)}` : '/api/v1/prompts'
  const res = await fetch(url)
  if (!res.ok) throw await parseError(res, 'Failed to load prompts')
  return res.json()
}

export async function getPrompt(id) {
  const res = await fetch(`/api/v1/prompts/${id}`)
  if (!res.ok) throw await parseError(res, 'Prompt not found')
  return res.json()
}

export async function createPrompt(payload) {
  const res = await fetch('/api/v1/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await parseError(res, 'Failed to create prompt')
  return res.json()
}

export async function updatePrompt(id, payload) {
  const res = await fetch(`/api/v1/prompts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await parseError(res, 'Failed to update prompt')
  return res.json()
}

export async function deletePrompt(id) {
  const res = await fetch(`/api/v1/prompts/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await parseError(res, 'Failed to delete prompt')
  return res.json()
}

// ─── AI-assisted variable suggestion (hybrid mode) ───────────────────────────
//
// Sends the prompt body to the current chat model and asks it to propose
// {{variables}} that would make the prompt reusable across different sources.
// Returns an array of variable definitions matching our schema.

export async function suggestVariables(body, apiKey, model, geminiKey) {
  const isGoogle = model.startsWith('gemini') || model.startsWith('gemma')
  const currentKey = isGoogle ? geminiKey : apiKey
  if (!currentKey) throw new Error(`No ${isGoogle ? 'Google AI' : 'OpenAI'} API key set.`)

  const system = `You are a prompt engineering assistant. Given a long-form analysis prompt, identify the parts that should be templatized as {{variables}} so the prompt can be reused across different videos, audiences, and user goals.

Return ONLY a JSON array (no prose, no markdown fences). Each element must be an object with:
- "name" (snake_case identifier, e.g. "video_type")
- "label" (Title Case human label)
- "description" (one sentence on what to fill in)
- "default" (a sensible default value)
- "type" ("text" | "textarea" | "select")
- "options" (string[], required only when type is "select")
- "autofill_source" (optional: "connected_node_type" if it should be inferred from connected source nodes)

Aim for 3–6 variables. Prefer: source type, user goals, target audience, depth/tone modifiers. Do NOT invent variables that don't make the prompt more flexible.`

  const user = `Analyze this prompt and propose variables:\n\n---\n${body}\n---`

  if (isGoogle) {
    const isGemma = model.startsWith('gemma')
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${system}` }] },
          { role: 'user', parts: [{ text: user }] },
        ],
        generationConfig: { temperature: 0.2 },
        ...(isGemma ? {} : { tools: [{ googleSearch: {} }] }),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error?.message || `Google AI error ${res.status}`)
    }
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return parseSuggestion(text)
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_completion_tokens: 1200,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI error ${res.status}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ''
  return parseSuggestion(text)
}

function parseSuggestion(text) {
  // Models sometimes wrap JSON in ```json fences despite instructions
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('Expected an array')
    return parsed.filter(v => v && typeof v.name === 'string')
  } catch (err) {
    throw new Error(`AI returned malformed variable JSON: ${err.message}`)
  }
}

// ─── Variation title helper ──────────────────────────────────────────────────

export function suggestVariationTitle(originalTitle) {
  if (!originalTitle) return 'Untitled (custom)'
  if (/\(custom\)$/i.test(originalTitle)) {
    // already a variation — bump a counter
    const m = originalTitle.match(/^(.*\(custom)(?:\s(\d+))?\)$/i)
    if (m) {
      const n = m[2] ? parseInt(m[2], 10) + 1 : 2
      return `${m[1]} ${n})`
    }
  }
  return `${originalTitle} (custom)`
}
