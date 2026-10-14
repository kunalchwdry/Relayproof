import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';


// Dev-only: serve the NVIDIA NIM routes from api/nim/* so `npm run dev` matches Vercel.
// The key comes from the NVIDIA_API_KEY environment variable of the dev process only.
const NIM_ROUTES = {
  '/api/nim/status': 'api/nim/status.js',
  '/api/nim/explain': 'api/nim/explain.js',
  '/api/nim/ocr': 'api/nim/ocr.js',
  '/api/nim/analyze-frames': 'api/nim/analyze-frames.js',
  '/api/nim/analyze-text': 'api/nim/analyze-text.js',
};
function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function nimDevRoutes() {
  return {
    name: 'relayproof-nim-dev-routes',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = NIM_ROUTES[(req.url || '').split('?')[0]];
        if (!route) return next();
        try {
          if (req.method === 'POST') {
            const raw = await readRequestBody(req, 6 * 1024 * 1024);
            req.body = raw ? JSON.parse(raw) : {};
          }
          const mod = await server.ssrLoadModule('/' + route);
          await mod.default(req, res);
        } catch {
          if (!res.headersSent) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ detail: 'The request body could not be read.' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), nimDevRoutes()],
  // Static hosting (GitHub Pages project site) serves from /<repo>/. Unset for local dev.
  base: process.env.PAGES_BASE || '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        // Send the backend a loopback Host (required by the local-request guard in
        // server/app.py) and strip the browser Origin, because the request reaching
        // the backend is same-origin from the app's point of view.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            // Server-side only: RELAYPROOF_API_TOKEN is deliberately not a VITE_ variable,
            // so the token never reaches the browser bundle.
            const apiToken = process.env.RELAYPROOF_API_TOKEN;
            if (apiToken) proxyReq.setHeader('Authorization', `Bearer ${apiToken}`);
          });
        },
      },
    },
  },
});
