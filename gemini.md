# 📜 PoppyAI — Project Constitution (gemini.md)

## 1. Data Schemas

### Node Schema

```json
{
  "id": "string (uuid)",
  "type": "media | document | ai-assistant | url | text | youtube",
  "position": { "x": "number", "y": "number" },
  "data": {
    "label": "string",
    "content": "string | File | URL",
    "mimeType": "string",
    "preview": "string (base64 or URL)",
    "metadata": {}
  },
  "width": "number",
  "height": "number"
}
```

### Edge (Connection) Schema

```json
{
  "id": "string",
  "source": "node-id",
  "target": "node-id",
  "animated": "boolean"
}
```

### AI Assistant Node Schema

```json
{
  "id": "string",
  "type": "ai-assistant",
  "connectedNodeIds": ["string"],
  "messages": [
    { "role": "user | assistant", "content": "string", "timestamp": "ISO" }
  ],
  "currentPrompt": "string",
  "model": "gpt-4o | claude-3-5-sonnet",
  "context": "synthesized string from connected nodes"
}
```

### Project Schema

```json
{
  "id": "string",
  "name": "string",
  "nodes": ["Node[]"],
  "edges": ["Edge[]"],
  "viewport": { "x": "number", "y": "number", "zoom": "number" },
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

## 2. Behavioral Rules

- Rule 1: AI Assistant nodes ONLY process content from directly connected nodes
- Rule 2: Dropped files are immediately previewed as nodes on the canvas at drop position
- Rule 3: API keys are stored in localStorage (never hardcoded)
- Rule 4: Canvas state is auto-saved to localStorage every 30 seconds
- Rule 5: Connections are always directional — content flows FROM source TO AI Assistant
- Rule 6: Multiple files dropped simultaneously create multiple nodes in a grid pattern

## 3. Architectural Invariants

- **Framework**: Vite + React (not Next.js — client-side only, no SSR needed)
- **Canvas Library**: React Flow (@xyflow/react) for node graph
- **Styling**: Vanilla CSS (no Tailwind)
- **AI**: OpenAI API (gpt-4o) via direct fetch calls from browser
- **Storage**: localStorage for persistence (no backend required for MVP)
- **File Handling**: FileReader API for local files, URL fetch for web content
- **State**: React Context + useReducer (no Redux overhead)

## 🕒 Maintenance Log

- **2026-02-23**: Project Initialized. PoppyAI canvas clone. Visual AI workspace with drag-drop nodes and AI synthesis.
