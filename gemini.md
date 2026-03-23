# 📜 PoppyAI — Project Constitution (gemini.md)

### User
```json
{
  "id": "string",
  "email": "string",
  "workspaces": ["WorkspaceID[]"]
}
```

### Workspace / Project Schema
```json
{
  "id": "string",
  "name": "string",
  "boards": ["BoardID[]"],
  "sources": ["SourceID[]"],
  "drafts": ["DraftID[]"],
  "analyses": ["AnalysisID[]"],
  "tags": ["string[]"],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

### Board Schema (Visual Canvas)
```json
{
  "id": "string",
  "name": "string",
  "nodes": ["Node[]"],
  "edges": ["Edge[]"],
  "viewport": { "x": "number", "y": "number", "zoom": "number" }
}
```

### Node Schema
```json
{
  "id": "string (uuid)",
  "type": "media | document | ai-assistant | url | text | youtube | tiktok",
  "position": { "x": "number", "y": "number" },
  "data": {
    "label": "string",
    "content": "string | File | URL",
    "mimeType": "string",
    "preview": "string (base64 or URL)",
    "metadata": {
      "transcript": "string",
      "summary": "string",
      "patterns": "PatternReportID"
    }
  },
  "width": "number",
  "height": "number"
}
```

### Edge Schema
```json
{
  "id": "string",
  "source": "node-id",
  "target": "node-id",
  "animated": "boolean"
}
```

### Pattern Report Schema
```json
{
  "id": "string",
  "sourceIds": ["string[]"],
  "patterns": {
    "hookFormula": "string",
    "retentionStructure": "string",
    "emotionalTriggers": "string",
    "pacing": "string",
    "cta": "string"
  }
}
```

## 2. Behavioral Rules

- **Grounded Responses**: AI must prioritize source material over generic knowledge. 
- **Pattern-First Analysis**: Viral analysis identifies likely patterns and hypotheses, not deterministic certainty.
- **Node Connectivity**: AI Assistant nodes only process content from directly connected source nodes.
- **Auto-Persist**: Canvas state and workspace data auto-save to localStorage every 30 seconds.
- **Flow Direction**: Content flows FROM source TO AI Assistant/Analysis nodes.
- **Safety**: Speculative patterns must be framed as "observed features" or "likely drivers."
- **Institutional Memory**: Workspaces preserve context and brand voice over time.

## 3. Architectural Invariants

- **Framework**: Vite + React (not Next.js — client-side only, no SSR needed)
- **Canvas Library**: React Flow (@xyflow/react) for node graph
- **Styling**: Vanilla CSS (no Tailwind)
- **AI**: OpenAI API (gpt-4o) via direct fetch calls from browser
- **Storage**: localStorage for persistence (no backend required for MVP)
- **File Handling**: FileReader API for local files, URL fetch for web content
- **State**: React Context + useReducer (no Redux overhead)

## 🕒 Maintenance Log

- **2026-03-23**: Updated Project Constitution based on PRD. Defined Content Intelligence Workspace vision.
