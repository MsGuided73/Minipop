import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Dev-only: the Express backend (server.js) listens on $PORT (default 3000).
  // Read it the same way server.js does — via .env — so moving the backend in
  // one place moves the proxy with it. $API_PORT overrides when the frontend
  // needs a different target than the backend's own PORT. Deploy is unaffected:
  // in production server.js serves the built bundle directly, no proxy.
  //
  // loadEnv (not process.env) is what makes the .env file visible here; Vite
  // does not populate process.env from .env, so a bare process.env.PORT would
  // silently miss the value server.js is actually using.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const API_PORT = env.API_PORT || env.PORT || 3000;

  return {
    server: {
      host: true,
      hmr: {
        clientPort: 5173
      },
      proxy: {
        '/api': {
          target: `http://localhost:${API_PORT}`,
          changeOrigin: true,
          secure: false,
        }
      }
    },
    plugins: [
      react()
    ],
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      css: false,
    },
  };
});
