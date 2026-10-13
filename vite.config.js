import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
