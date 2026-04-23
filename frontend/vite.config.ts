import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api': { target: 'https://sightseeing-system-iu8o.onrender.com', changeOrigin: true },
      '/pref': { target: 'http://localhost:3001', changeOrigin: true, rewrite: p => p.replace(/^\/pref/, '') },
    },
  },
})
