import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 휴대폰 접속용 개발 서버 (2026-11-04 사용자 승인: 모바일 웹만 와이파이 접속 허용, PC 웹 설정은 그대로).
// - 같은 코드·같은 주소 구조. 이 서버로 열고 화면 폭이 좁을 때(휴대폰)만 모바일 화면, 넓으면(태블릿·PC) PC 화면.
// - 포트 5175, 이 컴퓨터의 모든 네트워크 주소에서 받되, 아래 lanOnly 가 사설망(와이파이·이 컴퓨터) 주소만 통과시킵니다.
// - /api 는 같은 컴퓨터의 Django(127.0.0.1:8002)로 전달 → 백엔드는 계속 이 컴퓨터 안에서만 열려 있음.
const PRIVATE = [/^127\./, /^::1$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i]

function lanOnly(): Plugin {
  const guard = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    if (PRIVATE.some((r) => r.test(ip))) return next()
    res.statusCode = 403
    res.end('HRSG Explorer mobile dev server: local network only')
  }
  return { name: 'hrsg-lan-only', configureServer: (s) => void s.middlewares.use(guard) }
}

// 이 서버로 연 화면에서만 모바일 화면을 켭니다 (PC 주소 5174 는 창 크기와 상관없이 항상 PC 화면).
process.env.VITE_MOBILE_UI = '1'

export default defineConfig({
  plugins: [lanOnly(), react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    // Host 머리글을 127.0.0.1:8002 로 바꿔 Django ALLOWED_HOSTS(localhost·127.0.0.1)를 그대로 둡니다.
    // Origin 도 백엔드 주소로 맞춰 Django CSRF 출처 검사를 통과시킵니다 (CSRF 토큰 검사는 그대로 — 사설망 주소만 들어옴).
    proxy: { '/api': { target: 'http://127.0.0.1:8002', changeOrigin: true,
      configure: (proxy) => proxy.on('proxyReq', (req) => { if (req.getHeader('origin')) req.setHeader('origin', 'http://127.0.0.1:8002') }) } },
  },
})
