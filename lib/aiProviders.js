// The provider calls, server-side.
//
// These used to run in the browser, which meant the user's API key had to be
// in the browser to make them. Moving them here is the whole point of storing
// keys server-side: the key is read, used, and discarded within one request,
// and never crosses to a page where any script could read it.
//
// Ported from src/services/aiService.js — the request shapes below are the
// ones that were already working against each provider, deliberately
// unchanged. The prompt assembly stays on the client; only the call moved.

/**
 * Provider detection from a model id. Keeps routing in one place so every
 * call site agrees on which API and key a given model uses.
 *   google    → gemini* / gemma* / nano*
 *   anthropic → claude*
 *   openai    → everything else (gpt*, o1*, …)
 */
export function getProvider(model = '') {
  if (model.startsWith('gemini') || model.startsWith('gemma') || model.startsWith('nano')) return 'google'
  if (model.startsWith('claude')) return 'anthropic'
  return 'openai'
}

export const PROVIDER_LABELS = { google: 'Google AI', anthropic: 'Anthropic', openai: 'OpenAI' }

// Per-model output ceilings. Google is absent on purpose: that branch never
// sends an explicit limit, so Gemini/Gemma already run to their own maximum.
const MODEL_OUTPUT_CEILING = {
  'gpt-4o': 16384,
  'o1-preview': 32768,
  'claude-haiku-4-5-20251001': 64000,
}
const DEFAULT_OUTPUT_CEILING = 8192

// Auto-continue: when a provider stops because it hit the output ceiling
// rather than because the answer finished, ask it to keep going. Capped so a
// runaway model cannot bill the user's key forever.
const MAX_AUTO_CONTINUE_ROUNDS = 5

const CONTINUE_INSTRUCTION =
  'Your previous message was cut off before it finished. Continue from exactly where you stopped, ' +
  'mid-sentence if necessary. Do not repeat any text you already wrote, do not summarize what came ' +
  'before, and do not add a preamble — output only the remaining content. When the response is ' +
  'genuinely complete, simply stop.'

function clampMaxTokens(model, maxTokens) {
  if (maxTokens == null) return maxTokens
  return Math.min(maxTokens, MODEL_OUTPUT_CEILING[model] ?? DEFAULT_OUTPUT_CEILING)
}

/**
 * One call to whichever provider owns `model`.
 * @returns {Promise<{text: string, truncated: boolean}>} truncated is true when
 *   the model stopped on the output ceiling, which is what auto-continue reads.
 */
export async function callProvider({ apiKey, model, system, messages, temperature, maxTokens, useSearch = false }) {
  const provider = getProvider(model)
  const cappedMaxTokens = clampMaxTokens(model, maxTokens)

  if (provider === 'google') {
    const isGemma = model.startsWith('gemma')
    const contents = [
      ...(system ? [{ role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${system}` }] }] : []),
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ]

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(temperature != null ? { generationConfig: { temperature } } : {}),
          // Gemma has no tool support; search grounding is Gemini-only.
          ...(useSearch && !isGemma ? { tools: [{ googleSearch: {} }] } : {}),
        }),
      }
    )

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Google AI API error: ${response.status}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    const text = (candidate?.content?.parts || []).map(p => p.text || '').join('') || ''
    return { text, truncated: candidate?.finishReason === 'MAX_TOKENS' }
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: cappedMaxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(temperature != null ? { temperature } : {}),
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || ''
    return { text, truncated: data.stop_reason === 'max_tokens' }
  }

  // OpenAI. Reasoning models (o1/o3/o4) reject an explicit temperature.
  const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
      max_completion_tokens: cappedMaxTokens,
      ...(temperature != null && !isReasoningModel ? { temperature } : {}),
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
  }

  const data = await response.json()
  const choice = data.choices?.[0]
  return { text: choice?.message?.content || '', truncated: choice?.finish_reason === 'length' }
}

/**
 * A completion, re-prompting for more whenever the model stopped on the output
 * ceiling instead of finishing. Each partial goes back as an assistant turn so
 * the model knows where to resume.
 * @returns {Promise<{text: string, rounds: number}>}
 */
export async function runCompletion({ autoContinue = false, ...opts }) {
  let turns = opts.messages
  let full = ''
  let round = 0

  for (;; round++) {
    const { text, truncated } = await callProvider({ ...opts, messages: turns })
    full += text

    const canContinue = autoContinue && truncated && text && round < MAX_AUTO_CONTINUE_ROUNDS
    if (!canContinue) break

    turns = [
      ...turns,
      { role: 'assistant', content: text },
      { role: 'user', content: CONTINUE_INSTRUCTION },
    ]
  }

  return { text: full, rounds: round + 1 }
}

/**
 * One image, from whichever provider owns `model`.
 * @returns {Promise<string>} a data: URL
 */
export async function generateImage({ apiKey, model, prompt }) {
  if (model.startsWith('claude')) {
    throw new Error(
      'Image generation is not supported by Claude models. Switch to an OpenAI or Google model in Settings.'
    )
  }

  if (getProvider(model) === 'google') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
      }
    )

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Nano Banana 2 error: ${response.status}`)
    }

    const data = await response.json()
    const prediction = data.predictions?.[0]
    const b64 = prediction?.bytesBase64Encoded || prediction?.image?.bytesBase64Encoded || prediction?.b64_json
    if (!b64) throw new Error('No image data returned from Nano Banana 2')
    return `data:image/png;base64,${b64}`
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI Image error: ${response.status}`)
  }

  const data = await response.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data returned from OpenAI')
  return `data:image/png;base64,${b64}`
}
