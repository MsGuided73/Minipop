import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { ApifyClient } from 'apify-client';

dotenv.config();

const apifyClient = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}
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
app.get(['/api/transcript', '/api/v1/youtube'], authMiddleware, async (req, res) => {
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

    let metadata = {
      title: 'Unknown Title',
      uploader: 'Unknown Uploader',
      viewCount: 0,
      comments: []
    };
    let cleaned = '';
    let via = 'unknown';

    try {
      // ==========================================
      // TIER 1: Standard yt-dlp (Gets comments, views, full metadata, and subtitle)
      // ==========================================
      const commentsFlag = includeComments === 'true' ? '--get-comments --max-comments 20' : '';
      const metadataCmd = `yt-dlp --dump-json --skip-download ${commentsFlag} ${videoId}`;
      const { stdout: metadataStdout } = await execPromise(metadataCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      const metadataJson = JSON.parse(metadataStdout);

      metadata = {
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

      const outputBase = path.join(tmpDir, `prod_${videoId}`);
      const subCmd = `yt-dlp --write-subs --write-auto-subs --skip-download --sub-langs "en.*,en" --output "${outputBase}" --quiet ${videoId}`;
      await execPromise(subCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      const files = fs.readdirSync(tmpDir);
      const subFile = files.find(f => f.startsWith(`prod_${videoId}`) && f.endsWith('.vtt'));
      
      if (subFile) {
        const filePath = path.join(tmpDir, subFile);
        const content = fs.readFileSync(filePath, 'utf-8');
        const rawLines = content.replace(/<[^>]+>/g, '').split('\n').map(l => l.trim());
        const textLines = [];
        for (const line of rawLines) {
          if (!line || line === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
          if (line.includes('-->') || line.match(/^\d+$/) || line === '&nbsp;' || line === 'align:start position:0%') continue;
          if (textLines.length === 0 || textLines[textLines.length - 1] !== line) textLines.push(line);
        }
        cleaned = textLines.join(' ').replace(/\s+/g, ' ');
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      via = 'poppy-vps-primary';

      } catch (ytErr) {
      console.log(`[API] yt-dlp failed (Bot Block suspected). Falling back to Anti-Bot measures...`);
      
      // ==========================================
      // TIER 2: Anti-Bot Fallback (oEmbed + youtube-transcript)
      // ==========================================
      try {
        // Fetch basic metadata from public oEmbed endpoint
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (oembedRes.ok) {
           const oemData = await oembedRes.json();
           metadata.title = oemData.title || metadata.title;
           metadata.uploader = oemData.author_name || metadata.uploader;
        }

        // Fetch transcript natively via youtube-transcript library
        const transcriptBlocks = await YoutubeTranscript.fetchTranscript(videoId);
        cleaned = transcriptBlocks.map(b => b.text).join(' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
        via = 'poppy-vps-antibot-fallback';
      } catch (fallbackErr) {
        console.error('[API] Tier 2 scraping method failed:', fallbackErr.message);
        console.log(`[API] Proceeding to Tier-3 (Apify Fallback)...`);
        
        // ==========================================
        // TIER 3: The Hammer (Apify Scraping)
        // ==========================================
        try {
          if (!process.env.APIFY_API_TOKEN) {
            throw new Error("Missing APIFY_API_TOKEN from environment. Cannot run Tier-3 fallback.");
          }
          const run = await apifyClient.actor("karamelo/youtube-transcripts").call({
               urls: [`https://www.youtube.com/watch?v=${videoId}`]
          });
          const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
          if (items.length > 0 && items[0].captions && Array.isArray(items[0].captions)) {
              cleaned = items[0].captions.join(' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
              via = 'poppy-vps-apify-fallback';
              metadata.title = items[0].title || metadata.title;
              metadata.uploader = items[0].channelName || metadata.uploader;
          } else {
              throw new Error("Apify actor returned empty payload or invalid schema.");
          }

        } catch (apifyErr) {
          console.error('[API] Tier 3 (Apify) scraping failed:', apifyErr.message);
          // Do not return 404 here! We want to gracefully return whatever metadata we got from oEmbed
          console.log(`[API] Proceeding with metadata-only for ${videoId} due to complete transcript failure.`);
        }
      }
    }

    res.json({ 
      transcript: cleaned,
      metadata,
      via
    });

  } catch (err) {
    console.error('[API Error]:', err);
    res.status(500).json({ 
      error: 'ContentLoom was unable to fetch content: ' + err.message,
      detail: 'Ensure server dependencies are running properly.'
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
 * Prompts API — library of parameterized analysis prompts
 */
function mapPromptRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    description: row.description || '',
    tags: row.tags || [],
    variables: row.variables || [],
    defaultRunMode: row.default_run_mode || 'review',
    parentId: row.parent_id || null,
    isSeed: !!row.is_seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get('/api/v1/prompts', authMiddleware, async (req, res) => {
  let query = supabase.from('pop_prompts').select('*').order('created_at', { ascending: false });
  if (req.query.tag) query = query.contains('tags', [req.query.tag]);
  const { data, error } = await query;
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data.map(mapPromptRow));
});

app.get('/api/v1/prompts/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('pop_prompts').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Prompt not found' });
  res.json(mapPromptRow(data));
});

app.post('/api/v1/prompts', authMiddleware, async (req, res) => {
  const p = req.body;
  if (!p.title || !p.body) return res.status(400).json({ error: 'title and body are required' });
  const insert = {
    title: p.title,
    body: p.body,
    description: p.description || null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    variables: Array.isArray(p.variables) ? p.variables : [],
    default_run_mode: p.defaultRunMode === 'auto' ? 'auto' : 'review',
    parent_id: p.parentId || null,
    is_seed: false,
  };
  const { data, error } = await supabase.from('pop_prompts').insert(insert).select('*').single();
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(mapPromptRow(data));
});

app.put('/api/v1/prompts/:id', authMiddleware, async (req, res) => {
  const p = req.body;
  const update = {
    ...(p.title !== undefined && { title: p.title }),
    ...(p.body !== undefined && { body: p.body }),
    ...(p.description !== undefined && { description: p.description }),
    ...(p.tags !== undefined && { tags: Array.isArray(p.tags) ? p.tags : [] }),
    ...(p.variables !== undefined && { variables: Array.isArray(p.variables) ? p.variables : [] }),
    ...(p.defaultRunMode !== undefined && { default_run_mode: p.defaultRunMode === 'auto' ? 'auto' : 'review' }),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('pop_prompts').update(update).eq('id', req.params.id).select('*').single();
  if (error) {
    console.error('[Supabase Error]:', error);
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Prompt not found' });
  res.json(mapPromptRow(data));
});

app.delete('/api/v1/prompts/:id', authMiddleware, async (req, res) => {
  // Block deletion of seed prompts; encourage variations instead
  const { data: existing } = await supabase.from('pop_prompts').select('is_seed').eq('id', req.params.id).single();
  if (existing?.is_seed) return res.status(400).json({ error: 'Seed prompts cannot be deleted. Save a variation instead.' });

  const { error } = await supabase.from('pop_prompts').delete().eq('id', req.params.id);
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
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <div style="font-family: sans-serif; padding: 2rem; max-width: 600px; margin: auto; margin-top: 10%; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <h1 style="color: #dd6b20; margin-top: 0;">Production Build Not Found</h1>
        <p>The Express backend is active, but the frontend production bundle is missing from <code>dist/</code>.</p>
        <div style="background-color: #feebc8; border-left: 4px solid #dd6b20; padding: 1rem; margin: 1.5rem 0; border-radius: 4px;">
          <strong>For Local Development:</strong> Please use the Vite dev server at <a href="http://localhost:5173" style="color: #dd6b20; font-weight: bold; text-decoration: underline;">http://localhost:5173</a>, which supports hot module reloading.
        </div>
        <p>To run in production mode, generate the bundle first by executing:</p>
        <pre style="background-color: #edf2f7; padding: 0.75rem; border-radius: 4px; overflow-x: auto;"><code>npm run build</code></pre>
      </div>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ContentLoom Production Server live at http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'dist')}`);
  console.log(`💾 Connected to Supabase Project: ${supabaseUrl}`);
});
