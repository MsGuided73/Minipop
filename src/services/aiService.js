// src/services/aiService.js

/**
 * Builds the AI context string (source material + persona) from the React Flow nodes and edges.
 */
export function buildAIContext(aiNodeId, nodes, edges) {
  // Bidirectional: find nodes connected in either direction
  const connectedNodeIds = edges
    .filter(e => e.source === aiNodeId || e.target === aiNodeId)
    .map(e => e.source === aiNodeId ? e.target : e.source)
    .filter(nodeId => nodeId !== aiNodeId)

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
 * Handles generating chat responses based on node connections.
 */
export async function callAI(aiNodeId, userMessage, nodes, edges, apiKey, model, geminiKey) {
  const isGemini = model.startsWith('gemini')
  const currentKey = isGemini ? geminiKey : apiKey

  if (!currentKey) {
    throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
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

  if (isGemini) {
    const contents = [
      { role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemPrompt}` }] },
      ...history.slice(-12).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      { role: 'user', parts: [{ text: userMessage }] }
    ]

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents,
        tools: [{ googleSearch: {} }]
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    return data.candidates[0]?.content?.parts[0]?.text || ''
  } else {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ]

    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
    const requestBody = {
      model,
      messages,
      max_completion_tokens: 2000,
      ...(isReasoningModel ? {} : { temperature: 0.7 }),
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }
}

/**
 * Highly structured viral pattern analysis based on connected source nodes.
 */
export async function analyzeViralPatterns(aiNodeId, nodes, edges, apiKey, model, geminiKey) {
  const isGemini = model.startsWith('gemini')
  const currentKey = isGemini ? geminiKey : apiKey

  if (!currentKey) {
    throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
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

  if (isGemini) {
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'user', parts: [{ text: 'Perform a comprehensive viral pattern analysis across these sources.' }] }
    ]

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents, 
        generationConfig: { temperature: 0.4 },
        tools: [{ googleSearch: {} }]
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    return data.candidates[0]?.content?.parts[0]?.text || ''
  } else {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Perform a comprehensive viral pattern analysis across these sources.' },
    ]

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_completion_tokens: 2500,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }
}


/**
 * Generates a structured cross-reference matrix (agreements, contradictions, assumptions, gaps) based on connected source nodes.
 */
export async function generateCrossReference(aiNodeId, nodes, edges, apiKey, model, geminiKey) {
  const isGemini = model.startsWith('gemini')
  const currentKey = isGemini ? geminiKey : apiKey

  if (!currentKey) {
    throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
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
1. Overlapping Factual Claims (where sources agree).
2. Direct Contradictions (where sources conflict).
3. Underlying Assumptions (unproven premises the sources rely upon).
4. Logic/Evidence Gaps (what is missing from the arguments).

FORMAT REQUIREMENT:
You MUST output your final analysis as a markdown table with exactly these columns:
| Topic/Entity | Source Claim (with Source Name) | Conflicting/Agreeing Claim (with Source Name) | Assumptions Made | Logic/Evidence Gaps | Status (Agree/Conflict/Unique) |

Do not summarize outside the table unless necessary to explain a highly complex nuance. Ensure strict factual mapping directly to the source names.`

  if (isGemini) {
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'user', parts: [{ text: 'Generate the Cross-Reference Matrix.' }] }
    ]

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents, 
        generationConfig: { temperature: 0.2 },
        tools: [{ googleSearch: {} }]
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    return data.candidates[0]?.content?.parts[0]?.text || ''
  } else {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the Cross-Reference Matrix.' },
    ]

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2, // Lower temperature for more analytical/factual extraction
        max_completion_tokens: 3000,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }
}

/**
 * Handles image generation calls via OpenAI/Google models.
 */
export async function generateImage(prompt, apiKey, model, geminiKey) {
  const isGemini = model.startsWith('gemini') || model.startsWith('nano')
  const currentKey = isGemini ? geminiKey : apiKey

  if (!currentKey) {
    throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API key set. Open ⚙️ Settings and paste your key.`)
  }

  if (isGemini) {
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
