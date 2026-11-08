import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'react': fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
        xfwd: false,
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
// trigger restart
})
