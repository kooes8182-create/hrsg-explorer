// 화면 테스트용 최소 브라우저 제어 (Chrome DevTools Protocol). 추가 패키지 없이 Node 20 + 설치된 Chrome 만 사용합니다.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'hrsgx-e2e-'))
  const port = 9400 + Math.floor(Math.random() * 400)
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  // 테스트가 중간에 멈춰도 브라우저와 임시 프로필이 남지 않게
  process.on('exit', () => {
    proc.kill()
    rmSync(profile, { recursive: true, force: true })
  })
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      break
    } catch {
      await wait(250)
    }
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) (pending.get(msg.id)(msg), pending.delete(msg.id))
    if (msg.method) for (const f of listeners) f(msg)
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable')
  await send('DOM.enable')
  // 창이 보이지 않는 headless 에서도 실제 사용자처럼 칸에 들어가고 벗어나는 이벤트(focus/blur)가 나도록
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const page = {
    send,
    on: (f) => (listeners.add(f), () => listeners.delete(f)),
    wait,
    /** 페이지 안에서 식 실행 (Promise 면 기다림) */
    ev: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
      return r.result.result.value
    },
    async go(url, ms = 2500) {
      await send('Page.navigate', { url })
      await wait(ms)
    },
    async until(expr, ms = 20000) {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await page.ev(expr).catch(() => false)) return true
        await wait(300)
      }
      return false
    },
    size: (width, height = 1000, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }),
    text: () => page.ev('document.body.innerText'),
    /** 화면의 입력칸 값 바꾸기 (React 가 알아채도록 input 이벤트) */
    type: (selector, value) => page.ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`),
    click: (selector, text) => page.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if(!el) return false; el.click(); return true})()`),
    async setFile(selector, path) {
      const doc = await send('DOM.getDocument', { depth: -1 })
      const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector })
      await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [path] })
    },
    /** 같은 출처 API 호출 (세션·프록시 그대로) */
    // 로그인한 브라우저 세션 그대로 API 호출 (쓰기 요청에는 Django CSRF 토큰을 머리글로)
    api: (path, method = 'GET', body) => page.ev(`fetch('/api${path}', {method:'${method}', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-CSRFToken': decodeURIComponent((document.cookie.match(/(?:^|;\\s*)csrftoken=([^;]+)/)||[])[1]||'')}, body: ${body ? `JSON.stringify(${JSON.stringify(body)})` : 'undefined'}}).then(r => r.status === 204 ? null : r.json().then(j => Array.isArray(j) ? {http: r.status, items: j} : {...j, http: r.status}))`),
    /** 로그인 화면에서 실제로 입력해 로그인 (이전 계정은 먼저 로그아웃) */
    async loginAs(base, creds, waitPath) {
      await page.go(`${base}/login`, 1500)
      await page.ev(`fetch('/api/auth/me/').then(() => fetch('/api/auth/logout/', {method:'POST', credentials:'same-origin', headers:{'X-CSRFToken': decodeURIComponent((document.cookie.match(/(?:^|;\\s*)csrftoken=([^;]+)/)||[])[1]||'')}}))`)
      await page.go(`${base}/login`, 1500)
      await page.type('#login-emp', creds.employee_id)
      await page.type('#login-pw', creds.password)
      await page.ev(`document.querySelector('form button[type=submit]').click()`)
      return page.until(`location.pathname === ${JSON.stringify(waitPath)} && !document.querySelector('[data-boot]')`, 10000)
    },
    async close() {
      ws.close()
      proc.kill()
      await wait(300)
      rmSync(profile, { recursive: true, force: true })
    },
  }
  return page
}
