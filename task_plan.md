# 📋 Task Plan — PoppyAI Canvas Clone

## Goal

Build a full-featured visual AI canvas workspace cloning PoppyAI's core functionality:

- Infinite canvas with pan/zoom
- Drag & drop file/URL upload → creates nodes
- Node connections (content → AI Assistant)
- AI Assistant nodes that synthesize connected content
- Beautiful dark UI matching PoppyAI aesthetics

## Phase Checklist

### Phase 0: Setup ✅

- [x] gemini.md initialized
- [x] task_plan.md created
- [ ] Vite + React project scaffolded
- [ ] Dependencies installed

### Phase 1: Canvas Foundation

- [ ] Infinite canvas with pan/zoom (React Flow)
- [ ] Empty state UI
- [ ] Toolbar (add node, AI assistant button)
- [ ] Settings panel (API key input)

### Phase 2: Node Types

- [ ] Media Node (images, video preview)
- [ ] YouTube Node (thumbnail + title scrape)
- [ ] Document Node (PDF, text files)
- [ ] URL/Web Node (screenshot + summary)
- [ ] Text/Note Node
- [ ] AI Assistant Node (chat interface)

### Phase 3: Drag & Drop

- [ ] File drop zone on canvas
- [ ] Auto-detect file type → correct node
- [ ] URL paste → web node
- [ ] Multi-file drop → grid layout

### Phase 4: AI Integration

- [ ] Collect context from connected source nodes
- [ ] OpenAI API call with context
- [ ] Chat UI in AI Assistant node
- [ ] Previous chats history

### Phase 5: Persistence & Polish

- [ ] Auto-save to localStorage
- [ ] Load saved canvas on startup
- [ ] Export canvas as JSON
- [ ] Animations & micro-interactions
