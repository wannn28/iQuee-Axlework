import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from the root of https://axlework.iquee.tech
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
