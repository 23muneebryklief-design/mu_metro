import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://127.0.0.1:3000'
  const proxy = { '/api': apiTarget, '/health': apiTarget }

  return {
    plugins: [react()],
    server: {
      port: Number(process.env.FRONTEND_PORT || env.FRONTEND_PORT || 5173),
      strictPort: true,
      proxy,
    },
    preview: { proxy },
  }
})
