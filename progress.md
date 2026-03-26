# Progress Log - PoppyAI

## [2026-03-23]
- **Initialized Project Memory**: Created `task_plan.md`, `findings.md`, `progress.md`, and `gemini.md`.
- **Phase 2 Implementation**: Created `AnalysisNode.jsx` and updated `CanvasContext.jsx` with viral pattern analysis logic.
- **Bug Fix**: Resolved `SyntaxError` in `AnalysisNode.jsx` by correcting `lucide-react` icon imports.
- **Gemini Integration**: 
    - Added support for Gemini 3.1 Pro and Gemini Flash 2.5.
    - Implemented a dual-key system in `Settings.jsx` (OpenAI + Google Gemini).
    - Updated `CanvasContext.jsx` to route requests to Google AI for Gemini models.
    - Updated `AIAssistantNode` and `AnalysisNode` to pass the correct keys.

## [Notes]
- YouTube transcript fetch is currently hitting 404s due to scraping limitations. Need to investigate better fallback or proxy strategies.

## [2026-03-26] Dev Environment & YouTube Fetch Fixes
- Started the frontend dev server (`npm run dev`) on port 5173 and backend express proxy server (`node server.js`) on port 3000.
- **Bug Fix**: Discovered and fixed `execSync` ENOBUFS crashes in YouTube fetch proxy (added `maxBuffer: 10 * 1024 * 1024` for large JSON dumps).
- Ignored non-fatal `yt-dlp` stderr warnings by executing the subtitle download in a try/catch block so the server doesn't crash the request.
- **VTT Parsing Improvements**: Completely rebuilt the VTT string extraction logic in `server.js` to strip `<c>` tags, numeric identifiers, and timestamp boundaries (`-->`), and implemented rolling-line deduplication to extract flawless, continuous reading transcripts.
- **Proxy Bug Fix**: Removed a duplicated, outdated `yt-dlp` execution script embedded directly inside `vite.config.js` that was intercepting `/api/transcript` from the frontend and causing 500s. Configured Vite to correctly proxy `/api` traffic directly to the main `server.js` backend running on port 3000.
