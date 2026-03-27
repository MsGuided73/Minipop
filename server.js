import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || 'https://dfcppzpppqgphjjxypyw.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmY3BwenBwcHFncGhqanh5cHl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3Mjg5MDYsImV4cCI6MjA4NjMwNDkwNn0.iuVtlNdHAkh2Rpg4c8zAflGTexI04BwN0TcRhCVrhQo';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Simple Security: X-Poppy-Key
// In production, set POPPY_API_KEY in your environment to protect these endpoints.
const API_KEY = process.env.POPPY_API_KEY;
const authMiddleware = (req, res, next) => {
  if (API_KEY && req.headers['x-poppy-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid X-Poppy-Key' });
  }
  next();
};

// Serve static files from React build (dist)
app.use(express.static(path.join(__dirname, 'dist')));

/**
 * YouTube Data API
 * Supports both /api/transcript and /api/v1/youtube (unified)
 */
app.get(['/api/transcript', '/api/v1/youtube'], authMiddleware, (req, res) => {
  const { videoId: queryVideoId, url: queryUrl, includeComments } = req.query;
  let videoId = queryVideoId;

  // Extract videoId from full URL if provided
  if (!videoId && queryUrl) {
    const match = queryUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
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
    const metadataJson = JSON.parse(execSync(metadataCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }));

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
    try {
      execSync(subCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      console.log('[API] yt-dlp warning on subs:', e.message);
    }

    const files = fs.readdirSync(tmpDir);
    const subFile = files.find(f => f.startsWith(`prod_${videoId}`) && f.endsWith('.vtt'));
    
    let cleaned = '';
    if (subFile) {
      const filePath = path.join(tmpDir, subFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const rawLines = content
        .replace(/<[^>]+>/g, '') // Remove <c> tags and timestamps inside lines
        .split('\n')
        .map(l => l.trim());
      
      const textLines = [];
      for (const line of rawLines) {
        if (!line || line === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
        if (line.includes('-->')) continue; // Skip timestamp lines
        if (line.match(/^\d+$/)) continue; // Skip numeric ID lines
        if (line === '&nbsp;' || line === 'align:start position:0%') continue;
        
        // Remove duplicate rolling lines from auto-subs
        if (textLines.length === 0 || textLines[textLines.length - 1] !== line) {
          textLines.push(line);
        }
      }
      
      cleaned = textLines.join(' ').replace(/\s+/g, ' ');
      
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
      error: 'ContentLoom was unable to fetch content: ' + err.message,
      detail: 'Ensure yt-dlp is installed on the server and reachable.'
    });
  }
});

/**
 * Boards API - Save/Load
 */
app.get('/api/v1/boards', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('pop_boards').select('id, name, folder_id, created_at');
  
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }

  const summary = data.map(b => ({ 
    id: b.id, 
    name: b.name, 
    folderId: b.folder_id || null,
    createdAt: b.created_at 
  }));
  res.json(summary);
});

app.post('/api/v1/boards', authMiddleware, async (req, res) => {
  const board = req.body;
  if (!board.id || !board.nodes) return res.status(400).json({ error: 'Invalid board data' });
  
  const { error } = await supabase.from('pop_boards').upsert({
    id: board.id,
    name: board.name,
    folder_id: board.folderId || null,
    nodes: board.nodes,
    edges: board.edges,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, id: board.id });
});

app.get('/api/v1/boards/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('pop_boards').select('*').eq('id', req.params.id).single();
  
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(404).json({ error: 'Board not found' });
  }
  
  res.json({
    id: data.id,
    name: data.name,
    folderId: data.folder_id || null,
    nodes: data.nodes,
    edges: data.edges,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  });
});

/**
 * Folders API - Save/Load/Delete
 */
app.get('/api/v1/folders', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('pop_folders').select('*');
  
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }
  
  const folders = data.map(f => ({
    id: f.id,
    name: f.name,
    parentId: f.parent_id || null,
    createdAt: f.created_at,
    updatedAt: f.updated_at
  }));
  res.json(folders);
});

app.post('/api/v1/folders', authMiddleware, async (req, res) => {
  const folder = req.body;
  if (!folder.id || !folder.name) return res.status(400).json({ error: 'Invalid folder data' });
  
  const { error } = await supabase.from('pop_folders').upsert({
    id: folder.id,
    name: folder.name,
    parent_id: folder.parentId || null,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, id: folder.id });
});

app.delete('/api/v1/folders/:id', authMiddleware, async (req, res) => {
  const { error } = await supabase.from('pop_folders').delete().eq('id', req.params.id);
  
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

/**
 * Knowledge Query API (Embed Tool)
 * Allows external apps to "Ask" a board a question.
 */
app.post('/api/v1/boards/:id/query', authMiddleware, async (req, res) => {
  const { data: board, error } = await supabase.from('pop_boards').select('*').eq('id', req.params.id).single();
  if (error || !board) return res.status(404).json({ error: 'Board not found' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  // 1. Build Grounded Context from Nodes
  let sourceContext = "";
  let personaMandate = "";

  (board.nodes || []).forEach(node => {
    if (node.type === 'youtube') {
      sourceContext += `[YouTube: ${node.data.label}]\n${node.data.content}\n\n`;
    } else if (node.type === 'text') {
      sourceContext += `[Document: ${node.data.label}]\n${node.data.content}\n\n`;
    } else if (node.type === 'persona') {
      personaMandate = `[Tone/Brand Voice]: ${node.data.brandVoice || node.data.tone}\n[Target Audience]: ${node.data.audience}\n`;
    }
  });

  // 2. Return the prompt bundle for the outside application
  res.json({
    boardName: board.name,
    query,
    groundedContext: sourceContext,
    personaMandate,
    instruction: "Use the provided context and brand voice to answer the query accurately."
  });
});

// Fallback to index.html for React SPA routing
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 ContentLoom Production Server live at http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'dist')}`);
  console.log(`💾 Connected to Supabase Project: ${supabaseUrl}`);
});
