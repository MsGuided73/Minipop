// src/services/aiService.js

/**
 * Resolves all connected node IDs, including spatial inclusion via Group Nodes.
 */
export function resolveConnectedNodeIds(aiNodeId, nodes, edges) {
  let connectedNodeIds = edges
    .filter(e => e.source === aiNodeId || e.target === aiNodeId)
    .map(e => e.source === aiNodeId ? e.target : e.source)
    .filter(nodeId => nodeId !== aiNodeId)

  const connectedGroupNodes = nodes.filter(n => connectedNodeIds.includes(n.id) && n.type === 'groupNode')

  const isInside = (child, parent) => {
    // If the node already explicitly has this group as its parent, it is inside.
    if (child.parentId === parent.id) return true
    
    // If the node has a different parent, it is not inside this one.
    if (child.parentId && child.parentId !== parent.id) return false

    if (!child.position || !parent.position) return false
    const cw = child.measured?.width || child.style?.width || child.width || 300
    const ch = child.measured?.height || child.style?.height || child.height || 150
    const pw = parent.measured?.width || parent.style?.width || parent.width || 400
    const ph = parent.measured?.height || parent.style?.height || parent.height || 300
    
    // Compute absolute position fallback
    const childX = child.computed?.positionAbsolute?.x || child.positionAbsolute?.x || child.position.x
    const childY = child.computed?.positionAbsolute?.y || child.positionAbsolute?.y || child.position.y
    const parentX = parent.computed?.positionAbsolute?.x || parent.positionAbsolute?.x || parent.position.x
    const parentY = parent.computed?.positionAbsolute?.y || parent.positionAbsolute?.y || parent.position.y

    const cx = childX + cw / 2
    const cy = childY + ch / 2
    
    return (
      cx >= parentX &&
      cx <= parentX + pw &&
      cy >= parentY &&
      cy <= parentY + ph
    )
  }

  connectedGroupNodes.forEach(groupNode => {
    nodes.forEach(node => {
      if (node.id !== aiNodeId && node.id !== groupNode.id && !connectedNodeIds.includes(node.id)) {
        if (isInside(node, groupNode)) {
          connectedNodeIds.push(node.id)
        }
      }
    })
  })

  // Filter out the group nodes from the final count of actual content
  return connectedNodeIds.filter(id => {
    const node = nodes.find(n => n.id === id)
    return node && node.type !== 'groupNode'
  })
}

/**
 * Builds the AI context string (source material + persona) from the React Flow nodes and edges.
 */
export function buildAIContext(aiNodeId, nodes, edges) {
  const connectedNodeIds = resolveConnectedNodeIds(aiNodeId, nodes, edges)

  const personaNodes = nodes.filter(
    n => connectedNodeIds.includes(n.id) && n.type === 'personaNode'
  )

  const sourceNodes = nodes.filter(
    n => connectedNodeIds.includes(n.id) && n.type !== 'aiAssistantNode' && n.type !== 'personaNode'
  )

  const personaContext = personaNodes.map(node => {
    const connectingEdge = edges.find(e => 
      (e.source === node.id && e.target === aiNodeId) || 
      (e.target === node.id && e.source === aiNodeId)
    )
    const edgeLabel = connectingEdge?.data?.label ? `[Role/Focus: ${connectingEdge.data.label}] ` : ''
    return edgeLabel + (node.data.extractedText || '')
  }).join('\n\n')

  const sourceContext = sourceNodes.map(node => {
    const connectingEdge = edges.find(e => 
      (e.source === node.id && e.target === aiNodeId) || 
      (e.target === node.id && e.source === aiNodeId)
    )
    const semanticLabel = connectingEdge?.data?.label ? ` (Relationship: ${connectingEdge.data.label})` : ''
    
    const label = (node.data.label || node.type) + semanticLabel
    let content = ''

    switch (node.type) {
      case 'textNode':
        content = node.data.content || node.data.extractedText || '(empty note)'
        break
      case 'youtubeNode':
        content = [
          `YouTube Video URL: ${node.data.url || '(no url)'}`,
          node.data.extractedText && node.data.extractedText !== `URL: ${node.data.url}`
            ? `Transcript/Content:\n${node.data.extractedText}`
            : 'No transcript extracted — summarize based on your knowledge of the URL.',
        ].filter(Boolean).join('\n')
        break
      case 'urlNode':
        content = [
          `Web URL: ${node.data.url || '(no url)'}`,
          node.data.extractedText ? `Page content/notes: ${node.data.extractedText}` : '',
        ].filter(Boolean).join('\n')
        break
      case 'mediaNode':
        content = node.data.extractedText ||
          `Media file: "${node.data.label}" (${node.data.mimeType || 'unknown type'})`
        break
      case 'documentNode':
        content = node.data.extractedText ||
          `Document: "${node.data.label}". Text extraction requires server-side processing.`
        break
      default:
        content = node.data.extractedText || node.data.content || node.data.url || '(no content)'
    }

    return `### Source: "${label}" [${node.type}]\n${content}`
  }).join('\n\n---\n\n')

  return { sourceContext, personaContext }
}

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

const PROVIDER_LABELS = { google: 'Google AI', anthropic: 'Anthropic', openai: 'OpenAI' }

// Resolve the API key for a model from the three possible keys.
function keyForModel(model, { apiKey, geminiKey, anthropicKey }) {
  const provider = getProvider(model)
  if (provider === 'google') return geminiKey
  if (provider === 'anthropic') return anthropicKey
  return apiKey
}

// ─── Auto-continue ───────────────────────────────────────────────────────────
// When a provider stops because it hit the output-token ceiling rather than
// because the answer was finished, we can transparently ask it to keep going and
// stitch the pieces together. Capped so a runaway model can't bill forever.
const MAX_AUTO_CONTINUE_ROUNDS = 5

const CONTINUE_INSTRUCTION =
  'Your previous message was cut off before it finished. Continue from exactly where you stopped, ' +
  'mid-sentence if necessary. Do not repeat any text you already wrote, do not summarize what came ' +
  'before, and do not add a preamble — output only the remaining content. When the response is ' +
  'genuinely complete, simply stop.'

/**
 * Single low-level call to whichever provider owns `model`.
 *
 * `system` is the system instruction; `messages` is the user/assistant turn list
 * (no system role — each provider gets it in its native slot).
 *
 * Returns `{ text, truncated }` where `truncated` is true when the model stopped
 * because it ran out of output tokens, which is what auto-continue keys off.
 */
async function callProvider({ apiKey, model, system, messages, temperature, maxTokens, useSearch = false }) {
  const provider = getProvider(model)

  if (provider === 'google') {
    const isGemma = model.startsWith('gemma')
    const contents = [
      ...(system ? [{ role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${system}` }] }] : []),
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ]

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(temperature != null ? { generationConfig: { temperature } } : {}),
        // Gemma has no tool support; the search grounding is Gemini-only.
        ...(useSearch && !isGemma ? { tools: [{ googleSearch: {} }] } : {}),
      }),
    })

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
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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
      max_completion_tokens: maxTokens,
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
 * Runs a completion, optionally re-prompting the model to "continue" whenever it
 * stops on the output-token ceiling instead of finishing its answer. Each partial
 * is fed back as an assistant turn so the model knows exactly where to resume.
 *
 * With `autoContinue` off this is a single call — identical to the old behaviour.
 */
async function runCompletion({ autoContinue = false, ...opts }) {
  let turns = opts.messages
  let full = ''

  for (let round = 0; ; round++) {
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

  return full
}

/**
 * Handles generating chat responses based on node connections.
 */
export async function callAI(aiNodeId, userMessage, nodes, edges, apiKey, model, geminiKey, anthropicKey, options = {}) {
  const currentKey = keyForModel(model, { apiKey, geminiKey, anthropicKey })

  if (!currentKey) {
    throw new Error(`No ${PROVIDER_LABELS[getProvider(model)]} API key set. Open ⚙️ Settings and paste your key.`)
  }

  const { sourceContext, personaContext } = buildAIContext(aiNodeId, nodes, edges)

  let systemPrompt = `You are a helpful AI research assistant on a visual canvas workspace.`

  if (personaContext) {
    systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nYou MUST strictly follow this persona, tone, and audience targeting in your response.`
  }

  if (sourceContext) {
    systemPrompt += `\n\n=== CONNECTED SOURCES ===\n${sourceContext}\n=== END SOURCES ===
    
IMPORTANT INSTRUCTION FOR YOUTUBE/URLS:
If a connected source is a YouTube video or Website and the transcript/text is marked as "Unavailable" or "Failed to fetch", you MUST use your Google Search tool to research the video's content, summaries, and key points. Do NOT claim the content is unavailable until you have attempted a search.

Answer the user's request heavily grounded in these connected sources (and your search results where applicable). Be highly specific and cite the source labels.

PROACTIVE GUIDANCE & ENHANCED SUGGESTIONS:
1. Act as an embedded intelligent guide. Always look to provide actionable, enhanced suggestions based strictly on the provided content.
2. Anticipate the user's broader goal. Outline how the curated content specifically supports that goal.
3. GAP ANALYSIS: If the currently connected sources seem insufficient or leave critical gaps to complete the desired task, explicitly ask the user if they can provide or connect additional specific information, links, or nodes to help you finish the job completely.`
  } else {
    systemPrompt += `\n\nNo content nodes are connected yet — answering as a general assistant.`
  }

  const aiNode = nodes.find(n => n.id === aiNodeId)
  const history = aiNode?.data?.messages || []

  return runCompletion({
    apiKey: currentKey,
    model,
    system: systemPrompt,
    messages: [
      ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    maxTokens: 2000,
    useSearch: true,
    autoContinue: options.autoContinue,
  })
}

/**
 * Highly structured viral pattern analysis based on connected source nodes.
 */
export async function analyzeViralPatterns(aiNodeId, nodes, edges, apiKey, model, geminiKey, anthropicKey, options = {}) {
  const currentKey = keyForModel(model, { apiKey, geminiKey, anthropicKey })

  if (!currentKey) {
    throw new Error(`No ${PROVIDER_LABELS[getProvider(model)]} API key set. Open ⚙️ Settings and paste your key.`)
  }

  const { sourceContext, personaContext } = buildAIContext(aiNodeId, nodes, edges)
  if (!sourceContext && !personaContext) throw new Error('No sources or personas connected for analysis.')

  let systemPrompt = `You are a Content Intelligence Specialist. 
Your task is to perform a structured Viral Pattern Analysis on the provided source materials.`

  if (personaContext) {
    systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nYou MUST strictly analyze the materials through the lens of this persona and its target audience.`
  }

  if (sourceContext) {
    systemPrompt += `\n\n=== SOURCE MATERIALS ===\n${sourceContext}\n=== END SOURCES ===
    
IMPORTANT INSTRUCTION:
If a YouTube video or URL source is missing a transcript or text (e.g. marked as "Failed to fetch"), you MUST use your Google Search tool to research the video title, creator, and content to extract these patterns.`
  }

  systemPrompt += `\n\nAnalyze the materials for:
1. Hook Formula: How does it grab attention in the first 5-15 seconds?
2. Retention Structure: How is pacing and tension maintained?
3. Emotional Triggers: What emotions (awe, humor, fear, curiosity) are leveraged?
4. Pacing & Momentum: Narrative arc and speed.
5. CTA Placement: How and when is the audience prompted to act?

- Frame findings as "observed patterns" and "likely drivers".
- Avoid definitive certainty; use hypothesis-driven language.
- Mention the source label for each insight.`

  return runCompletion({
    apiKey: currentKey,
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Perform a comprehensive viral pattern analysis across these sources.' }],
    temperature: 0.4,
    maxTokens: 2500,
    useSearch: true,
    autoContinue: options.autoContinue,
  })
}


/**
 * Generates a structured cross-reference matrix (agreements, contradictions, assumptions, gaps) based on connected source nodes.
 */
export async function generateCrossReference(aiNodeId, nodes, edges, apiKey, model, geminiKey, anthropicKey, options = {}) {
  const currentKey = keyForModel(model, { apiKey, geminiKey, anthropicKey })

  if (!currentKey) {
    throw new Error(`No ${PROVIDER_LABELS[getProvider(model)]} API key set. Open ⚙️ Settings and paste your key.`)
  }

  const { sourceContext, personaContext } = buildAIContext(aiNodeId, nodes, edges)
  if (!sourceContext && !personaContext) throw new Error('No sources connected for cross-referencing.')

  let systemPrompt = `You are an Expert Investigative Researcher and Fact-Checker.
Your task is to analyze the provided source materials and generate a rigorously structured "Cross-Reference Matrix" to help the user synthesize the truth.`

  if (personaContext) {
    systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nYou MUST strictly analyze the materials through the lens of this persona.`
  }

  if (sourceContext) {
    systemPrompt += `\n\n=== SOURCE MATERIALS ===\n${sourceContext}\n=== END SOURCES ===`
  }

  systemPrompt += `\n\nAnalyze the materials specifically for:
1. Overlapping Factual Claims (where sources agree) vs. Direct Contradictions (where they conflict).
2. Underlying Assumptions & Logical Fallacies (e.g., strawman, ad hominem, false equivalence, non sequitur).
3. LOGIC/EVIDENCE GAPS: You MUST actively hunt down and expose logic gaps. Do NOT gloss over or skip them. Point out exactly what evidence is missing, what leaps of logic are made, or where the argument breaks down.
4. INFLAMMATORY LANGUAGE & PUSHED NARRATIVE: Highlight loaded, emotional, or manipulative rhetoric, and explicitly state the underlying narrative or agenda the author is pushing.

FORMAT REQUIREMENT:
You MUST output your final analysis as a detailed Markdown Report, divided into clear headings corresponding to the criteria above. Use bullet points, bold text, and blockquotes to make the investigative report easy to digest and highly structured.
Do NOT format as a table - provide a comprehensive, long-form narrative analysis.`

  return runCompletion({
    apiKey: currentKey,
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generate the structured investigative Cross-Reference Report.' }],
    temperature: 0.2, // Lower temperature for more analytical/factual extraction
    maxTokens: 3000,
    useSearch: true,
    autoContinue: options.autoContinue,
  })
}

/**
 * Converts a generated textual Cross-Reference Report into a strict Markdown table.
 */
export async function generateCrossReferenceTable(reportText, apiKey, model, geminiKey, anthropicKey, options = {}) {
  const currentKey = keyForModel(model, { apiKey, geminiKey, anthropicKey })

  if (!currentKey) {
    throw new Error(`No ${PROVIDER_LABELS[getProvider(model)]} API key set. Open ⚙️ Settings and paste your key.`)
  }

  const systemPrompt = `You are an expert Data Structurer. Your task is to extract the findings from the provided investigative report and convert them STRICTLY into a Markdown table.
Do not add any new analysis, just format the existing findings.

FORMAT REQUIREMENT:
You MUST output ONLY a markdown table with exactly these columns:
| Topic/Entity | Competing Claims & Sources | Assumptions & Fallacies | Logic & Evidence Gaps | Narrative & Rhetoric | Status (Agree/Conflict) |`

  return runCompletion({
    apiKey: currentKey,
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Here is the report to convert:\n\n${reportText}\n\nGenerate the Markdown table.` }],
    temperature: 0.1,
    maxTokens: 2000,
    useSearch: false,
    autoContinue: options.autoContinue,
  })
}

/**
 * Send one turn of a Lens conversation. The renderedPrompt is the persistent system
 * instruction (the same on every turn); `history` is prior chat exchanges; `userMessage`
 * is the latest user input (for the initial run this is a fixed kickoff string).
 * Returns the assistant's reply text.
 */
export const LENS_KICKOFF = 'Begin the analysis now. Output the complete report in the format specified.'

export async function callLensChat(lensNodeId, userMessage, renderedPrompt, history, nodes, edges, apiKey, model, geminiKey, anthropicKey, options = {}) {
  const currentKey = keyForModel(model, { apiKey, geminiKey, anthropicKey })

  if (!currentKey) {
    throw new Error(`No ${PROVIDER_LABELS[getProvider(model)]} API key set. Open ⚙️ Settings and paste your key.`)
  }

  const { sourceContext, personaContext } = buildAIContext(lensNodeId, nodes, edges)

  let systemPrompt = renderedPrompt
  if (personaContext) {
    systemPrompt += `\n\n=== MANDATORY BRAND PERSONA & TONE ===\n${personaContext}\n\nFilter all output through this persona.`
  }
  if (sourceContext) {
    systemPrompt += `\n\n=== CONNECTED SOURCES ===\n${sourceContext}\n=== END SOURCES ===\n\nAnchor every observation to these sources. Cite source labels in your output. For follow-up questions, stay grounded in these same sources.`
  } else {
    systemPrompt += `\n\n(No source nodes connected. Note this limitation if relevant.)`
  }

  const trimmedHistory = (history || []).slice(-20)

  return runCompletion({
    apiKey: currentKey,
    model,
    system: systemPrompt,
    messages: [
      ...trimmedHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ],
    temperature: 0.4,
    maxTokens: 4000,
    useSearch: true,
    autoContinue: options.autoContinue,
  })
}

/**
 * Handles image generation calls via OpenAI/Google models.
 */
export async function generateImage(prompt, apiKey, model, geminiKey) {
  if (model.startsWith('claude')) {
    throw new Error('Image generation is not supported by Claude models. Switch to an OpenAI or Google model in ⚙️ Settings to generate images.')
  }
  const isGoogle = model.startsWith('gemini') || model.startsWith('gemma') || model.startsWith('nano')
  const currentKey = isGoogle ? geminiKey : apiKey

  if (!currentKey) {
    throw new Error(`No ${isGoogle ? 'Google AI' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
  }

  if (isGoogle) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${currentKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1 }
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Nano Banana 2 error: ${response.status}`)
    }

    const data = await response.json()
    const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded || data.predictions?.[0]?.b64_json
    if (!b64) throw new Error("No image data returned from Nano Banana 2")
    return `data:image/png;base64,${b64}`
  } else {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json"
      }),
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `OpenAI Image error: ${response.status}`)
    }

    const data = await response.json()
    const b64 = data.data?.[0]?.b64_json
    if (!b64) throw new Error("No image data returned from OpenAI")
    return `data:image/png;base64,${b64}`
  }
}
