import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Served from the root of https://axlework.iquee.tech; nginx proxies /api/ to the Go API.
// In dev, `npm run dev` proxies /api to the API on localhost:8080 (override with API_PROXY=... in env or .env.local).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'API_')
  return {
    base: '/',
    plugins: [react()],
    server: {
      proxy: { '/api': { target: env.API_PROXY || 'http://localhost:8080', changeOrigin: true } },
    },
    preview: {
      proxy: { '/api': { target: env.API_PROXY || 'http://localhost:8080', changeOrigin: true } },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] },
        },
      },
    },
  }
})
