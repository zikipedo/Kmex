import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.API_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  server: {
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/media': { target, changeOrigin: true },
    },
  },
  build: {
    manifest: true, // lu par le service worker pour pré-cacher toute l'application
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
})
