import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API = process.env.KEPLER_API ?? 'http://127.0.0.1:8787'

// Zusätzliche erlaubte Hosts für die Vorschau (kommagetrennt über
// KEPLER_PREVIEW_HOSTS). Der Host-Check bleibt aktiv — es werden nur die
// ausdrücklich genannten Namen freigeschaltet.
const previewHosts = (process.env.KEPLER_PREVIEW_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    allowedHosts: previewHosts.length ? previewHosts : undefined,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
