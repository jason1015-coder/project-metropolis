import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // GitHub Pages serves a project site from /<repo>/, so the deploy workflow
  // passes that path in as VITE_BASE_PATH. Local dev and root builds keep '/'.
  const base = loadEnv(mode, '.', 'VITE_BASE_PATH').VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [react(), tailwindcss()],
    server: { port: 5174, strictPort: false },
  }
})
