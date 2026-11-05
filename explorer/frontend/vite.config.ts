import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 서버: localhost:5174 전용. /api 요청은 Django(127.0.0.1:8002)로 전달합니다.
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8002' },
  },
})
