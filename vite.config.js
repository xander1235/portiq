import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const removeCrossorigin = () => {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    }
  }
}

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [react(), tailwindcss(), removeCrossorigin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@codemirror')) {
              if (id.includes('/lang-')) {
                return 'vendor-codemirror-langs';
              }
              return 'vendor-codemirror-core';
            }
            if (id.includes('@uiw')) {
              return 'vendor-codemirror-ui';
            }
            if (id.includes('@xenova/transformers') || id.includes('onnxruntime-web')) {
              return 'vendor-transformers';
            }
            if (id.includes('react-markdown') || id.includes('rehype-highlight')) {
              return 'vendor-markdown';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('fuse.js')) {
              return 'vendor-search';
            }
            if (id.includes('@octokit') || id.includes('libsodium')) {
              return 'vendor-heavy';
            }
            if (id.includes('@radix-ui') || id.includes('lucide-react')) {
              return 'vendor-ui';
            }
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/github-oauth': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-oauth/, '')
      },
      '/proxy-openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-openai/, '')
      },
      '/proxy-anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-anthropic/, '')
      },
      '/proxy-gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-gemini/, '')
      }
    }
  }
});
