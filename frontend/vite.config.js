import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 개발 서버는 localhost 에서만 열고, /api 요청은 Django(127.0.0.1:8001)로 전달합니다.
// 8000 은 상위 폴더의 다른 앱이 사용 중이라 8001 을 씁니다.
export default defineConfig({
  plugins: [vue()],
  // public 폴더를 쓰지 않습니다 (reference/ 의 원문 PDF 등이 정적 파일로 나가지 않도록).
  publicDir: false,
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8001', changeOrigin: true },
    },
  },
})
