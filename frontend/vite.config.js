import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
        // SSE through the proxy hangs when http-proxy reuses a keep-alive
        // socket whose upstream side the backend already closed. Fresh
        // connection per request removes the race.
        agent: new http.Agent({ keepAlive: false }),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[proxy]', err.message)
          })
        },
      },
    },
  },
})