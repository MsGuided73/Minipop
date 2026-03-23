# 📋 Task Plan — PoppyAI Canvas Clone

## Goal

Build a full-featured visual AI canvas workspace cloning PoppyAI's core functionality:

- Infinite canvas with pan/zoom
- Drag & drop file/URL upload → creates nodes
- Node connections (content → AI Assistant)
- AI Assistant nodes that synthesize connected content
- Beautiful dark UI matching PoppyAI aesthetics

## roadmap

### Phase 1: Core MVP (Ingest & Foundations)
- [ ] Multi-format ingestion (PDF, YouTube link, Text, Images)
- [ ] Project/Workspace management
- [ ] Infinite Canvas foundation (@xyflow/react)
- [ ] LocalStorage persistence engine

### Phase 2: Analysis & Intelligence (The "Viral" Layer)
- [ ] Transcript/Text extraction pipeline
- [ ] Single-video pattern analysis node
- [ ] Multi-video comparison engine
- [ ] Grounded AI Chat (RAG over connected nodes)

### Phase 3: Synthesis & Creation (The "Ship" Layer)
- [ ] Output Editor (Scripts, Hooks, Briefs)
- [ ] Template system for recurring patterns
- [ ] Brand Voice/Persona memory
- [ ] Export system (Text, Reports)

### Phase 4: Polish & Growth
- [ ] Animations & Micro-interactions
- [ ] Collaboration features (Shared views)
- [ ] Advanced visual briefing layers

## Verification Plan

### Automated Tests
- `npm test`: Verify node creation and connection logic.
- `vitest`: Unit tests for transcript extraction and pattern mapping.

### Manual Verification
- Dropping a YouTube link → Verify thumbnail and transcript extraction.
- Connecting 3 videos to an AI node → Verify pattern report generation.
- Generating a "Hook" from analyzed patterns → Verify alignment with PRD principles.
