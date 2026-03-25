import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * PoppyAI YouTube MCP Server
 * Exposes yt-dlp hardened extraction logic to any AI assistant.
 */
class YouTubeServer {
  constructor() {
    this.server = new Server(
      {
        name: "poppy-youtube-fetcher",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "fetch_youtube_content",
          description: "Fetch transcript and rich metadata from a YouTube URL.",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Full YouTube URL (e.g., https://www.youtube.com/watch?v=...)",
              },
              includeComments: {
                type: "boolean",
                description: "Whether to include the top 20 audience comments (slower).",
                default: false,
              },
            },
            required: ["url"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== "fetch_youtube_content") {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }

      const { url, includeComments } = request.params.arguments;
      const videoIdMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
      const videoId = videoIdMatch?.[1];

      if (!videoId) {
        return {
          content: [{ type: "text", text: "Invalid YouTube URL provided." }],
          isError: true,
        };
      }

      try {
        const tmpDir = path.resolve(process.cwd(), ".tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

        // 1. Get Metadata
        const commentsFlag = includeComments ? "--get-comments --max-comments 20" : "";
        const metadataCmd = `yt-dlp --dump-json --skip-download ${commentsFlag} ${videoId}`;
        const metadataJson = JSON.parse(execSync(metadataCmd, { encoding: "utf-8" }));

        // 2. Get Subtitles
        const outputBase = path.join(tmpDir, `mcp_${videoId}`);
        const subCmd = `yt-dlp --write-auto-subs --skip-download --sub-lang en --output "${outputBase}" --quiet ${videoId}`;
        execSync(subCmd);

        const files = fs.readdirSync(tmpDir);
        const subFile = files.find((f) => f.startsWith(`mcp_${videoId}`) && f.endsWith(".vtt"));
        
        let transcript = "(No transcript found)";
        if (subFile) {
          const filePath = path.join(tmpDir, subFile);
          const rawContent = fs.readFileSync(filePath, "utf-8");
          transcript = this.cleanVTT(rawContent);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        const payload = {
          title: metadataJson.title,
          uploader: metadataJson.uploader,
          viewCount: metadataJson.view_count,
          description: metadataJson.description,
          uploadDate: metadataJson.upload_date,
          transcript,
          comments: (metadataJson.comments || []).map(c => ({
            author: c.author,
            text: c.text
          }))
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch YouTube content: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  cleanVTT(content) {
    return content
      .replace(/WEBVTT/g, "")
      .replace(/Kind: captions/g, "")
      .replace(/Language: en/g, "")
      .replace(/\d\d:\d\d:\d\d\.\d\d\d --> \d\d:\d\d:\d\d\.\d\d\d.*/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/align:start position:0%/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.match(/^\d+$/))
      .join(" ")
      .replace(/\s+/g, " ");
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("YouTube MCP Server running on stdio");
  }
}

const server = new YouTubeServer();
server.run().catch(console.error);
