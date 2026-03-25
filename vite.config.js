import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'transcript-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          // Unified API v1
          if (req.url.startsWith('/api/v1/youtube') || req.url.startsWith('/api/transcript')) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            let videoId = url.searchParams.get('videoId');
            const fullUrl = url.searchParams.get('url');

            // If a full URL is provided, extract the videoId
            if (!videoId && fullUrl) {
              const match = fullUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
              videoId = match?.[1] || null;
            }
            
            if (!videoId) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: 'Missing videoId or url' }));
            }

            try {
              const tmpDir = path.resolve(process.cwd(), '.tmp');
              if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

              // 1. Get Metadata (JSON) - Optional Comments
              const includeComments = url.searchParams.get('includeComments') === 'true';
              const commentsFlag = includeComments ? '--get-comments --max-comments 20' : '';
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
              const outputBase = path.join(tmpDir, `api_${videoId}`);
              const subCmd = `yt-dlp --write-auto-subs --skip-download --sub-lang en --output "${outputBase}" --quiet ${videoId}`;
              execSync(subCmd);

              const files = fs.readdirSync(tmpDir);
              const subFile = files.find(f => f.startsWith(`api_${videoId}`) && f.endsWith('.vtt'));
              
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

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ 
                transcript: cleaned,
                metadata,
                via: 'local-proxy' 
              }));
              
            } catch (err) {
              console.error('Transcript Proxy Error:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ 
                error: 'Local fetch failed: ' + err.message,
                detail: 'Ensure yt-dlp is installed and the video is not restricted.'
              }));
            }
            return;
          }
          next();
        });
      }
    }
  ],
});
