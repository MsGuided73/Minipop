import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from React build (dist)
app.use(express.static(path.join(__dirname, 'dist')));

/**
 * YouTube Data API
 * Supports both /api/transcript and /api/v1/youtube (unified)
 */
app.get(['/api/transcript', '/api/v1/youtube'], (req, res) => {
  const { videoId: queryVideoId, url: queryUrl, includeComments } = req.query;
  let videoId = queryVideoId;

  // Extract videoId from full URL if provided
  if (!videoId && queryUrl) {
    const match = queryUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    videoId = match?.[1] || null;
  }

  if (!videoId) {
    return res.status(400).json({ error: 'Missing videoId or url' });
  }

  try {
    const tmpDir = path.resolve(process.cwd(), '.tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    console.log(`[API] Fetching content for ${videoId} (Comments: ${includeComments})`);

    // 1. Get Metadata
    const commentsFlag = includeComments === 'true' ? '--get-comments --max-comments 20' : '';
    const metadataCmd = `yt-dlp --dump-json --skip-download ${commentsFlag} ${videoId}`;
    const metadataJson = JSON.parse(execSync(metadataCmd, { encoding: 'utf-8' }));

    const metadata = {
      title: metadataJson.title,
      description: metadataJson.description,
      viewCount: metadataJson.view_count,
      likeCount: metadataJson.like_count,
      duration: metadataJson.duration,
      uploader: metadataJson.uploader,
      uploadDate: metadataJson.upload_date,
      comments: (metadataJson.comments || []).map(c => ({
        author: c.author,
        text: c.text,
        likeCount: c.like_count
      }))
    };

    // 2. Get Subtitles
    const outputBase = path.join(tmpDir, `prod_${videoId}`);
    const subCmd = `yt-dlp --write-auto-subs --skip-download --sub-lang en --output "${outputBase}" --quiet ${videoId}`;
    execSync(subCmd);

    const files = fs.readdirSync(tmpDir);
    const subFile = files.find(f => f.startsWith(`prod_${videoId}`) && f.endsWith('.vtt'));
    
    let cleaned = '';
    if (subFile) {
      const filePath = path.join(tmpDir, subFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      cleaned = content
        .replace(/WEBVTT/g, '')
        .replace(/Kind: captions/g, '')
        .replace(/Language: en/g, '')
        .replace(/\d\d:\d\d:\d\d\.\d\d\d --> \d\d:\d\d:\d\d\.\d\d\d.*/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/align:start position:0%/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.match(/^\d+$/))
        .join(' ')
        .replace(/\s+/g, ' ');
      
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    res.json({ 
      transcript: cleaned,
      metadata,
      via: 'poppy-vps-proxy' 
    });

  } catch (err) {
    console.error('[API Error]:', err);
    res.status(500).json({ 
      error: 'PoppyAI was unable to fetch content: ' + err.message,
      detail: 'Ensure yt-dlp is installed on the server and reachable.'
    });
  }
});

// Boards storage
const BOARDS_FILE = path.resolve(process.cwd(), '.tmp/boards.json');
const ensureBoardsFile = () => {
  if (!fs.existsSync(BOARDS_FILE)) {
    fs.writeFileSync(BOARDS_FILE, JSON.stringify({}));
  }
};

/**
 * Boards API - Save/Load
 */
app.get('/api/v1/boards', (req, res) => {
  ensureBoardsFile();
  const boards = JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf-8'));
  const summary = Object.values(boards).map(b => ({ id: b.id, name: b.name, createdAt: b.createdAt }));
  res.json(summary);
});

app.post('/api/v1/boards', (req, res) => {
  ensureBoardsFile();
  const board = req.body;
  if (!board.id || !board.nodes) return res.status(400).json({ error: 'Invalid board data' });
  
  const boards = JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf-8'));
  boards[board.id] = { ...board, updatedAt: new Date().toISOString() };
  fs.writeFileSync(BOARDS_FILE, JSON.stringify(boards, null, 2));
  res.json({ success: true, id: board.id });
});

app.get('/api/v1/boards/:id', (req, res) => {
  ensureBoardsFile();
  const boards = JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf-8'));
  const board = boards[req.params.id];
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

/**
 * Knowledge Query API (Embed Tool)
 * Allows external apps to "Ask" a board a question.
 */
app.post('/api/v1/boards/:id/query', (req, res) => {
  ensureBoardsFile();
  const boards = JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf-8'));
  const board = boards[req.params.id];
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  // 1. Build Grounded Context from Nodes
  let sourceContext = "";
  let personaMandate = "";

  board.nodes.forEach(node => {
    if (node.type === 'youtube') {
      sourceContext += `[YouTube: ${node.data.label}]\n${node.data.content}\n\n`;
    } else if (node.type === 'text') {
      sourceContext += `[Document: ${node.data.label}]\n${node.data.content}\n\n`;
    } else if (node.type === 'persona') {
      personaMandate = `[Tone/Brand Voice]: ${node.data.brandVoice || node.data.tone}\n[Target Audience]: ${node.data.audience}\n`;
    }
  });

  // 2. Return the prompt bundle for the outside application
  // In a full implementation, we'd fetch OpenAI here using an ENV key.
  // For now, we return the "Grounded Payload" so the client dashboard can call their own AI.
  res.json({
    boardName: board.name,
    query,
    groundedContext: sourceContext,
    personaMandate,
    instruction: "Use the provided context and brand voice to answer the query accurately."
  });
});

// Fallback to index.html for React SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 PoppyAI Production Server live at http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'dist')}`);
  console.log(`💾 Boards store ready at: ${BOARDS_FILE}`);
});
