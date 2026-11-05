// HRSG Explorer 화면 테스트 (프롬프트 PART 9 의 T01~T18). 실행: npm run e2e  (백엔드 8002·프론트 5174 가 켜져 있어야 함)
//
// - 임시 케이스만 만들어 쓰고 마지막에 지웁니다. DEMO 케이스·업로드 문헌은 건드리지 않습니다.
// - 바꾼 설정(외부 AI 전송, 표시 단위, 언어·테마)은 끝나면 원래대로 돌립니다.
// - 외부 AI(Claude) 실제 호출은 하지 않습니다. E2E_LLM=1 일 때만 T14 에서 한 번 호출합니다 (비용 발생).
// - 서버 끊김(T03)은 서버를 끄지 않고, 브라우저에서 상태 확인 요청만 실패시켜 시험합니다.
// - 로그인: 테스트 전용 임시 계정(e2e-plant·e2e-admin, 난수 비밀번호)을 만들어 실제 로그인 화면으로 들어가고, 끝나면 계정을 지웁니다.
// - 설정 화면·API 는 모든 역할에 막혀 있어, 외부 AI 설정은 운영자 명령(manage.py ai_settings)으로 바꿉니다.
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupE2eCases, createE2eAccounts, deleteE2eAccounts, getSettings, setSettings } from './backend.mjs'
import { launch } from './browser.mjs'

const BASE = process.env.E2E_BASE || 'http://localhost:5174'
const results = []
const created = []
let p

function expect(ok, detail) {
  if (!ok) throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300))
}
const ONLY = (process.env.E2E_ONLY || '').split(',').filter(Boolean)
async function test(id, name, fn) {
  if (ONLY.length && !ONLY.some((x) => id.startsWith(x))) return
  const t0 = Date.now()
  try {
    await fn()
    results.push({ id, name, ok: true, ms: Date.now() - t0 })
    console.log(`  ✓ ${id} ${name}`)
  } catch (e) {
    results.push({ id, name, ok: false, ms: Date.now() - t0, error: e.message })
    console.log(`  ✗ ${id} ${name}\n      → ${e.message}`)
  }
}
async function newCase(name) {
  const c = await p.api('/cases/', 'POST', { name })
  created.push(c.id)
  return c
}
const useCase = (cid, extra = {}) => p.ev(`localStorage.setItem('hrsgx.prefs', JSON.stringify(${JSON.stringify({ lang: 'ko', currentCaseId: cid, ...extra })}))`)

p = await launch()
await p.size(1440, 1200)
await p.go(`${BASE}/login`)
const health = await p.api('/health/')
if (health.http !== 200) {
  console.error('서버가 응답하지 않습니다. 백엔드(127.0.0.1:8002)와 프론트(localhost:5174)를 먼저 켜세요.')
  await p.close()
  process.exit(2)
}
const settingsBefore = getSettings()
const acc = createE2eAccounts()
if (!(await p.loginAs(BASE, acc.plant, '/dashboard'))) {
  console.error('테스트 계정으로 로그인하지 못했습니다.')
  deleteE2eAccounts()
  await p.close()
  process.exit(2)
}
console.log(`HRSG Explorer 화면 테스트 — ${BASE} (플랜트 엔지니어로 로그인)\n`)

try {
  // ------------------------------------------------------------------ 공통 시스템
  await test('T02', '마지막 케이스 삭제 차단 (서버) — 케이스 관리 화면(설정)은 이번 메뉴에 없음', async () => {
    const cases = (await p.api('/cases/')).items
    if (cases.length === 1) {
      const r = await p.api(`/cases/${cases[0].id}/`, 'DELETE')
      expect(r.http === 409 && r.error.code === 'LAST_CASE', r)
    } else {
      const a = await newCase('E2E T02')
      const r = await p.api(`/cases/${a.id}/`, 'DELETE')
      created.splice(created.indexOf(a.id), 1)
      expect(r === null, '여러 개일 때는 삭제되어야 함')
    }
  })

  await test('T01', '케이스 독립성 (A 수정 → B 전환 → A 복귀)', async () => {
    const a = await newCase('E2E A')
    const b = await newCase('E2E B')
    await useCase(a.id)
    await p.go(`${BASE}/simulation`, 3000)
    await p.type('#in-currentBP', 444)
    await p.click('button', '평가 실행')
    await p.until(`document.body.innerText.includes('계산 ·') || !document.body.innerText.includes('입력 1개 변경')`, 8000)
    await p.wait(1000)
    await p.type('select[aria-label="평가 케이스 선택"]', b.id)
    await p.wait(1500)
    const bVal = await p.ev(`document.getElementById('in-currentBP').value`)
    await p.type('select[aria-label="평가 케이스 선택"]', a.id)
    await p.wait(1500)
    const aVal = await p.ev(`document.getElementById('in-currentBP').value`)
    expect(bVal === '350' && aVal === '444', { bVal, aVal })
  })

  await test('T03', '서버 연결이 끊기면 상태 표시가 비정상으로 바뀜', async () => {
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/health/*' }] })
    const off = p.on((m) => m.method === 'Fetch.requestPaused' && p.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionRefused' }))
    await p.go(`${BASE}/dashboard`, 2500) // 화면 시작 때 연결 점검 → 실패
    const shown = await p.until(`document.querySelector('[role=alert]')?.innerText.includes('서버 연결 불가')`, 5000)
    off()
    await p.send('Fetch.disable')
    await p.click('button', '지금 점검')
    const back = await p.until(`!document.querySelector('header [role=alert]')`, 5000)
    expect(shown && back, { shown, back })
  })

  // ------------------------------------------------------------------ 계산·연동
  const c = await newCase('E2E 흐름')
  await useCase(c.id)

  await test('T07', '발전 출력 손실 150 MW·100%·초과 100 mmH₂O → 0.195 MW (화면 KPI)', async () => {
    await p.go(`${BASE}/simulation`, 3000)
    await p.click('button', '평가 실행')
    const ok = await p.until(`[...document.querySelectorAll('[data-kpi]')].some(e => e.innerText.startsWith('0.195'))`, 10000)
    expect(ok, 'KPI 에 0.195 가 보이지 않음')
  })

  await test('T08', '입력값을 하나라도 바꾸면 재평가 필요', async () => {
    await p.type('#in-stackTempC', 116)
    const ok = await p.until(`document.body.innerText.includes('입력이 바뀌어')`, 3000)
    await p.click('button', '평가 실행')
    const cleared = await p.until(`!document.body.innerText.includes('입력이 바뀌어')`, 8000)
    expect(ok && cleared, { ok, cleared })
  })

  await test('T04', '시뮬레이션에서 배압 수정·재평가 → 대시보드 KPI·공정도에 같은 값', async () => {
    await p.type('#in-currentBP', 450)
    await p.click('button', '평가 실행')
    await p.until(`!document.body.innerText.includes('입력이 바뀌어')`, 8000)
    await p.click('nav a', '대시보드')
    await p.until(`document.body.innerText.includes('HRSG 공정 흐름도')`, 8000)
    const kpi = await p.ev(`[...document.querySelectorAll('.card')].find(e=>e.textContent.startsWith('발전 출력 손실'))?.innerText`)
    const diagram = await p.ev(`[...document.querySelectorAll('svg text')].some(t => t.textContent.includes('450'))`)
    const api = (await p.api(`/cases/${c.id}/results/`)).results.performance.payload.lossMW.value
    expect(kpi?.includes('0.39') && diagram && api === 0.39, { kpi, diagram, api })
  })

  await test('T06', '단위 변환 1 mmH₂O = 0.00980665 kPa (서버 변환표·화면 표시 단위)', async () => {
    const s = await p.api('/inputs/schema/')
    const ratio = s.units.kPa.factor / s.units.mmH2O.factor
    expect(Math.abs(ratio - 0.00980665) < 1e-12, ratio)
    await useCase(c.id, { pressureUnit: 'kPa' })
    await p.go(`${BASE}/dashboard`, 3000)
    const bp = await p.ev(`[...document.querySelectorAll('.card')].find(e=>e.textContent.startsWith('가스터빈 배압'))?.innerText`)
    await useCase(c.id)
    expect(bp?.includes('4.413') && bp.includes('kPa') && bp.includes('2.452'), bp) // 450 mmH₂O = 4.413 kPa, 기준 250 = 2.452 kPa (저장값은 그대로 mmH₂O)
  })

  await test('T05', '대시보드 누락 항목 클릭 → 체크리스트 해당 행 강조', async () => {
    await p.go(`${BASE}/dashboard`, 3000)
    await p.click('a', 'A-01')
    await p.wait(2000)
    const path = await p.ev('location.pathname + location.search')
    const hl = await p.ev(`[...document.querySelectorAll('tr')].some(tr => tr.className.includes('ring-accent') && tr.textContent.includes('A-01'))`)
    expect(path === '/checklist?item=A-01' && hl, { path, hl })
  })

  await test('T09', '실측값이 없는 항목을 검증 완료로 바꾸면 차단', async () => {
    await p.type('select[aria-label="A-02 검증 상태"]', 'VERIFIED')
    const blocked = await p.until(`document.body.innerText.includes('측정값이 없으면 검증 완료로 바꿀 수 없습니다')`, 5000)
    const state = (await p.api(`/cases/${c.id}/checklist/`)).items.find((i) => i.id === 'A-02').state.verify_status
    expect(blocked && state === 'UNVERIFIED', { blocked, state })
  })

  await test('T10', "'요청 필요' 항목만 요청 메일 초안에 포함", async () => {
    await p.type('select[aria-label="A-03 수급 상태"]', 'REQUEST_NEEDED')
    await p.wait(800)
    await p.type('select[aria-label="B-02 수급 상태"]', 'REQUEST_NEEDED')
    await p.wait(800)
    await p.click('button', '요청 메일 초안')
    await p.wait(400)
    await p.click('[role=dialog] button', '초안 생성')
    await p.until(`!!document.getElementById('mail-body')`, 5000)
    const body = await p.ev(`document.getElementById('mail-body').value`)
    expect(body.includes('A-03') && body.includes('B-02') && !body.includes('A-01 ') && !body.includes('B-01'), body.slice(0, 200))
    await p.click('[role=dialog] button[aria-label="닫기"]')
  })

  await test('T11', '세정 전후 실측값 추가 → 그래프에 바로 반영', async () => {
    await p.go(`${BASE}/before-after`, 3000)
    const add = async (v) => {
      for (const [k, x] of Object.entries(v)) await p.type(`#m-${k}`, x)
      await p.click('button[type=submit]', '추가')
      await p.wait(1500)
    }
    await add({ dayOffset: -3, backPressure: 450, loadFactor: 100, ambientTempC: 15 })
    await add({ dayOffset: 7, backPressure: 270, loadFactor: 92, ambientTempC: 16 })
    const markers = await p.ev(`document.querySelectorAll('svg circle').length`)
    const rows = await p.ev(`document.querySelectorAll('tbody tr').length`)
    expect(markers >= 2 && rows >= 2, { markers, rows })
  })

  await test('T12', '부하율 차이 > 5%p 또는 외기 차이 > 5 °C → 편차 경고', async () => {
    const warn = await p.until(`document.body.innerText.includes('운전 조건 편차가 커서 세정 효과를 단정할 수 없습니다')`, 5000)
    expect(warn, '부하율 8%p 차이인데 경고 없음')
  })

  // ------------------------------------------------------------------ AI·RAG
  await test('T13', 'BM25·BGE-M3·Hybrid 비교, 각 상위 8개 근거 (AI 관리자)', async () => {
    await p.loginAs(BASE, acc.admin, '/rag-evaluation')
    await p.go(`${BASE}/rag-evaluation`, 2500)
    await p.click('button[role=tab]', '질문별 검색 비교')
    await p.wait(400)
    await p.type('input[aria-label="질문"]', 'HRSG 가스측 압력손실이 가스터빈 출력에 미치는 영향')
    await p.click('button[type=submit]', '비교')
    await p.until(`document.querySelectorAll('ol li').length >= 24`, 120000)
    const cols = await p.ev(`[...document.querySelectorAll('ol')].slice(0,3).map(o => o.querySelectorAll(':scope > li').length)`)
    await p.loginAs(BASE, acc.plant, '/dashboard')
    await useCase(c.id)
    expect(cols.length === 3 && cols.every((n) => n === 8), cols)
  })

  await test('T14', 'AI 비활성 → 가짜 답변 없이 근거 검색만', async () => {
    setSettings({ ai_external_enabled: false })
    await p.go(`${BASE}/ai-assistant`, 2500)
    await p.type('textarea[aria-label="질문"]', '절탄기 스티밍은 왜 피해야 하나요?')
    await p.click('button[type=submit]', '질문')
    await p.until(`document.body.innerText.includes('답변을 만들지 않았습니다')`, 120000)
    const ev = await p.ev(`document.querySelectorAll('aside ol > li').length`)
    const fake = await p.ev(`document.body.innerText.includes('핵심 요약')`)
    expect(ev >= 1 && ev <= 8 && !fake, { ev, fake })
    if (process.env.E2E_LLM === '1') {
      setSettings({ ai_external_enabled: true })
      await p.go(`${BASE}/ai-assistant`, 2500)
      await p.type('textarea[aria-label="질문"]', 'HRSG 차압이 커지면 가스터빈 출력이 줄어드는 이유는?')
      await p.click('button[type=submit]', '질문')
      const ok = await p.until(`document.body.innerText.includes('핵심 요약')`, 150000)
      setSettings({ ai_external_enabled: settingsBefore.ai_external_enabled })
      expect(ok, 'Claude 답변(6개 절)이 오지 않음')
    }
  })

  await test('T15', '전화번호·이메일·등록 식별정보는 전송·저장 전에 가림', async () => {
    setSettings({ sensitive_terms: [...settingsBefore.sensitive_terms, '가상발전소E2E'] })
    await p.type('textarea[aria-label="질문"]', '가상발전소E2E 담당 010-1111-2222 test@example.com 배압 문의')
    await p.click('button[type=submit]', '질문')
    await p.until(`document.body.innerText.includes('[전화번호]')`, 60000)
    const t = await p.text()
    setSettings({ sensitive_terms: settingsBefore.sensitive_terms })
    expect(t.includes('[식별정보]') && t.includes('[이메일]') && !t.includes('010-1111-2222') && !t.includes('가상발전소E2E'), 'masking 실패')
  })

  // ------------------------------------------------------------------ 전체 흐름
  await test('T16', '케이스 생성 → 체크리스트 → 시뮬레이션 → 계산 → 심층 분석 → 세정 전후 → AI 질문 → 결과 저장', async () => {
    const f = await newCase('E2E 전체 흐름')
    await useCase(f.id)
    await p.go(`${BASE}/checklist`, 3000)
    await p.click('button[aria-expanded]', '운전 배압')
    await p.wait(500)
    await p.ev(`document.getElementById('A-02-value').focus()`)  // 사용자처럼 칸에 들어갔다가
    await p.type('#A-02-value', 342)
    await p.ev(`document.getElementById('A-02-value').blur()`)   // 칸을 벗어나면 자동 저장
    await p.wait(1200)
    await p.go(`${BASE}/simulation`, 3000)
    await p.click('button', '오염 진행')
    await p.click('button', '평가 실행')
    await p.until(`document.body.innerText.includes('DEMO 시나리오에 지정된 상태')`, 10000)
    await p.go(`${BASE}/simulation`, 3000)
    const calcBP = await p.ev(`document.getElementById('in-currentBP').value`)
    await p.go(`${BASE}/analysis?tab=pinch`, 3000)
    const tsat = await p.ev(`document.body.innerText.includes('포화온도')`)
    await p.go(`${BASE}/before-after`, 3000)
    await p.go(`${BASE}/simulation`, 3000)
    // 시뮬레이션 '결과 저장'(스냅샷) → 'AI에게 질문하기' 로 화면 이동 없이 플로팅 AI 창에 화면 데이터 첨부
    await p.click('button', '결과 저장')
    await p.wait(800)
    await p.click('#page-actions button', 'AI에게 질문하기')
    await p.until(`location.pathname === '/simulation' && document.querySelector('#copilot')?.innerText.includes('화면 데이터 첨부')`, 8000)
    await p.type('textarea[aria-label="AI에게 질문"]', '이 계산 결과의 초과 배압은 어떤 의미인가요?')
    await p.click('button[aria-label="전송"]')
    await p.until(`document.querySelector('#copilot')?.innerText.includes('참고 문헌')`, 60000)
    await p.click('button[aria-label="닫기"]')
    const snaps = (await p.api(`/cases/${f.id}/snapshots/`)).items
    const item = (await p.api(`/cases/${f.id}/checklist/`)).items.find((i) => i.id === 'A-02').state.value
    const conv = (await p.api(`/cases/${f.id}/conversations/`)).items
    const ov = await p.api(`/cases/${f.id}/overview/`)
    expect(calcBP === '342' && tsat && snaps.length >= 1 && item === '342' && conv.length === 1 && ov.status.code === 'ALARM' && ov.workflow[3].state === 'done',
      { calcBP, tsat, snaps: snaps.length, item, conv: conv.length, status: ov.status.code, ai: ov.workflow[3].state })
  })

  await test('T17', '새로고침 후에도 케이스·저장 데이터 유지', async () => {
    const cid = await p.ev(`JSON.parse(localStorage.getItem('hrsgx.prefs')).currentCaseId`)
    await p.go(`${BASE}/simulation`, 3000)
    await p.send('Page.reload')
    await p.wait(3000)
    const sel = await p.ev(`document.querySelector('select[aria-label="평가 케이스 선택"]').value`)
    const bp = await p.ev(`document.getElementById('in-currentBP').value`)
    expect(String(sel) === String(cid) && bp === '342', { sel, cid, bp })
  })

  await test('T18', '라이트/다크·한국어/영어 전환이 전체 화면에 적용', async () => {
    await p.go(`${BASE}/dashboard`, 3000)
    await p.click('button', 'EN')
    await p.ev(`document.querySelector('button[aria-label="Toggle theme"]').click()`)
    await p.wait(400)
    const bad = []
    for (const path of ['dashboard', 'checklist', 'simulation', 'analysis', 'before-after', 'ai-assistant', 'reference']) {
      await p.go(`${BASE}/${path}`, 1800)
      const h1 = await p.ev(`document.querySelector('h1').textContent`)
      const dark = await p.ev(`document.documentElement.classList.contains('dark')`)
      const hangulTitle = /[가-힣]/.test(h1)
      if (hangulTitle || !dark) bad.push({ path, h1, dark })
    }
    await useCase(await p.ev(`JSON.parse(localStorage.getItem('hrsgx.prefs')).currentCaseId`))
    expect(bad.length === 0, bad)
  })

  // ------------------------------------------------------------------ Floating AI Assistant
  const copilotText = `(document.querySelector('#copilot')?.innerText ?? '')`
  const selectCase = (id) => p.ev(`(()=>{const s=document.querySelector('select[aria-label="평가 케이스 선택"]'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,${JSON.stringify(String(id))}); s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const ga = await newCase('E2E 코파일럿 A')
  const gb = await newCase('E2E 코파일럿 B')
  setSettings({ ai_external_enabled: false }) // 외부 전송 없이 근거 검색 모드로 검사
  await useCase(ga.id)
  await p.ev(`localStorage.removeItem('hrsgx.copilot')`)

  await test('T19', '모든 화면 오른쪽 아래 플로팅 AI 버튼 (AI 전체 화면에서는 숨김)', async () => {
    const miss = []
    for (const path of ['dashboard', 'checklist', 'simulation', 'analysis', 'before-after', 'reference', 'notifications']) {
      await p.go(`${BASE}/${path}`, 1500)
      const r = await p.ev(`(()=>{const b=document.querySelector('[data-copilot-fab] button'); if(!b) return null; const x=b.getBoundingClientRect(); return {right: innerWidth - x.right, bottom: innerHeight - x.bottom, w: x.width, pos: getComputedStyle(b.parentElement).position}})()`)
      if (!r || r.pos !== 'fixed' || r.w < 56 || r.right > 30 || r.bottom > 30) miss.push({ path, r })
    }
    await p.go(`${BASE}/ai-assistant`, 1500)
    const onAiPage = await p.ev(`!!document.querySelector('[data-copilot-fab]')`)
    expect(miss.length === 0 && !onAiPage, { miss, onAiPage })
  })

  await test('T20', '열기·닫기·사이드 패널 확장(1600px 이상 본문 축소, 그 미만 겹쳐 띄움)·축소·Esc', async () => {
    await p.go(`${BASE}/dashboard`, 2500)
    await p.click('[data-copilot-fab] button')
    const float = await p.until(`document.querySelector('#copilot')?.dataset.copilot === 'float'`, 3000)
    const fw = await p.ev(`document.querySelector('#copilot').getBoundingClientRect().width`)
    await p.click('button[aria-label="사이드 패널로 확장"]')
    const panel = await p.until(`document.querySelector('#copilot')?.dataset.copilot === 'panel'`, 3000)
    await p.wait(400)
    // 1440px: 본문은 그대로, 패널은 겹쳐 띄움(배경막) · 1680px: 본문을 패널 너비만큼 줄임(메뉴는 아이콘만)
    const overlay = await p.ev(`document.querySelector('main').getBoundingClientRect().right > document.querySelector('#copilot').getBoundingClientRect().left`)
    await p.size(1680, 1000)
    await p.wait(500)
    const geo = await p.ev(`(()=>{const c=document.querySelector('#copilot').getBoundingClientRect(); const m=document.querySelector('main').getBoundingClientRect(); return {cw: c.width, ch: c.height, h: innerHeight, mainRight: m.right, left: c.left, mainW: m.width}})()`)
    await p.size(1440, 1200)
    await p.click('button[aria-label="작은 창으로"]')
    const back = await p.until(`document.querySelector('#copilot')?.dataset.copilot === 'float'`, 3000)
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    const closed = await p.until(`!document.querySelector('#copilot')`, 3000)
    // 패널은 화면 높이 전체, 본문은 패널에 가리지 않음 (본문 오른쪽 끝 ≤ 패널 왼쪽)
    expect(float && Math.abs(fw - 420) < 2 && panel && overlay && geo.cw === 520 && geo.ch === geo.h && geo.mainRight <= geo.left + 1 && geo.mainW >= 1000 && back && closed, { float, fw, panel, overlay, geo, back, closed })
  })

  await test('T21', '다른 메뉴로 이동해도 대화 유지 · 케이스를 바꾸면 그 케이스의 대화로 전환', async () => {
    await p.go(`${BASE}/dashboard`, 2500)
    await p.click('[data-copilot-fab] button')
    await p.type('textarea[aria-label="AI에게 질문"]', '절탄기 스티밍은 왜 피해야 하나요?')
    await p.click('button[aria-label="전송"]')
    const answered = await p.until(`${copilotText}.includes('답변을 만들지 않았습니다')`, 120000)
    await p.click('nav a', '체크리스트')  // SPA 이동 (새로고침 아님)
    await p.wait(800)
    const kept = await p.ev(`location.pathname === '/checklist' && ${copilotText}.includes('절탄기 스티밍은 왜 피해야 하나요?')`)
    await selectCase(gb.id)
    const switched = await p.until(`!${copilotText}.includes('절탄기 스티밍') && ${copilotText}.includes('논문 근거로 답하는')`, 5000)
    await selectCase(ga.id)
    const restored = await p.until(`${copilotText}.includes('절탄기 스티밍은 왜 피해야 하나요?')`, 5000)
    const convA = await p.api(`/cases/${ga.id}/conversations/`)
    const convB = await p.api(`/cases/${gb.id}/conversations/`)
    expect(answered && kept && switched && restored && convA.items.length === 1 && convB.items.length === 0, { answered, kept, switched, restored, a: convA.items.length, b: convB.items.length })
  })

  await test('T22', "화면의 'AI에게 질문하기' → 서버 값으로 만든 화면 데이터 첨부 → 질문에 사용", async () => {
    await p.api(`/cases/${ga.id}/evaluate/all/`, 'POST')
    await p.go(`${BASE}/checklist`, 2500)
    await p.click('#page-actions button', 'AI에게 질문하기')
    const attached = await p.until(`${copilotText}.includes('화면 데이터 첨부') && document.querySelector('textarea[aria-label="AI에게 질문"]').value.length > 5`, 5000)
    await p.click('button[aria-label="전송"]')
    await p.until(`${copilotText}.split('답변을 만들지 않았습니다').length > 2`, 120000)
    const conv = (await p.api(`/cases/${ga.id}/conversations/`)).items[0]
    const msgs = (await p.api(`/conversations/${conv.id}/`)).messages
    const last = msgs[msgs.length - 1].payload
    const ok = last.context?.page === 'checklist' && last.context.lines.some((x) => x.startsWith('missing required:')) && msgs[msgs.length - 2].payload.context === 'checklist'
    expect(attached && ok, { attached, ctx: last.context?.page, lines: last.context?.lines?.length })
  })

  await test('T23', '모바일(390px)·다크 모드: 거의 전체 화면 채팅, 입력창 아래 고정, 닫기', async () => {
    await p.size(390, 844, true)
    await useCase(ga.id, { theme: 'dark' })
    await p.go(`${BASE}/simulation`, 2500)
    const fab = await p.ev(`!!document.querySelector('[data-copilot-fab] button')`)
    await p.click('[data-copilot-fab] button')
    await p.wait(500)
    const g = await p.ev(`(()=>{const c=document.querySelector('#copilot').getBoundingClientRect(); const f=document.querySelector('#copilot form').getBoundingClientRect(); return {w: c.width, h: c.height, formBottom: Math.round(f.bottom), ih: innerHeight, bg: getComputedStyle(document.querySelector('#copilot')).backgroundColor}})()`)
    await p.click('button[aria-label="닫기"]')
    const closed = await p.until(`!document.querySelector('#copilot')`, 3000)
    await p.size(1440, 1200)
    await useCase(ga.id)
    expect(fab && g.w === 390 && g.h >= 800 && Math.abs(g.formBottom - g.ih) <= 1 && g.bg !== 'rgb(255, 255, 255)' && closed, { fab, g, closed })
  })

  // ------------------------------------------------------------------ 통합 알림 센터
  const panelText = `(document.querySelector('#notification-center')?.innerText ?? '')`
  const openBell = async () => {
    if (!(await p.ev(`!!document.querySelector('#notification-center')`))) await p.click('[data-bell]')
    await p.until(`!!document.querySelector('#notification-center') && !${panelText}.includes('불러오지 못했')`, 5000)
    await p.wait(600)
  }
  const closeBell = () => p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  const notes = async (cid) => (await p.api(`/notifications/?case=${cid}`)).items
  const na = await newCase('E2E 알림 A')
  const nb = await newCase('E2E 알림 B')
  await useCase(na.id)

  await test('T24', '필수 데이터 누락 알림 → 누르면 체크리스트 해당 항목으로 이동', async () => {
    await p.go(`${BASE}/dashboard`, 3000)
    await openBell()
    const shown = await p.ev(`${panelText}.includes('필수 데이터') && ${panelText}.includes('미수신')`)
    await p.click('#notification-center [data-notification="data.missing_required"] button', '관련 화면')
    const moved = await p.until(`location.pathname === '/checklist' && location.search.startsWith('?item=') && !document.querySelector('#notification-center')`, 5000)
    const hl = await p.until(`[...document.querySelectorAll('tr')].some(tr => tr.className.includes('ring-accent'))`, 5000)
    expect(shown && moved && hl, { shown, moved, hl })
  })

  await test('T25', '입력값 변경 → 재평가 필요 알림 + 경고 토스트 (계산하면 해결)', async () => {
    await p.go(`${BASE}/simulation`, 3000)
    await p.click('button', '평가 실행')
    await p.wait(300)
    await p.until(`!document.body.innerText.includes('평가 실행 중') && !document.body.innerText.includes('계산 중')`, 15000)
    const inputs = await p.api(`/cases/${na.id}/inputs/`)
    await p.api(`/cases/${na.id}/inputs/`, 'PUT', { mode: inputs.mode, scenario: 'CUSTOM', values: { ...inputs.values, currentBP: 372 } }) // 다른 화면에서 입력 저장
    await openBell()
    const raised = await p.until(`${panelText}.includes('재평가 필요')`, 5000)
    const toasted = await p.until(`[...document.querySelectorAll('[data-toast]')].some(t => t.innerText.includes('재평가 필요'))`, 4000)
    await closeBell()
    await p.go(`${BASE}/simulation`, 3000)
    await p.click('button', '평가 실행')
    await p.wait(2500)
    const open = (await notes(na.id)).filter((n) => n.eventKey === 'calc.stale' && !n.resolvedAt)
    expect(raised && toasted && open.length === 0, { raised, toasted, open: open.length })
  })

  await test('T26', '계산 실패 → 오류 알림, 같은 오류를 반복해도 1건 (성공하면 해결)', async () => {
    await p.go(`${BASE}/simulation`, 3000)
    await p.type('#in-loadFactor', 130)
    for (let i = 0; i < 3; i++) { await p.click('button', '평가 실행'); await p.wait(700) }
    await openBell()
    const shown = await p.ev(`${panelText}.includes('계산 실패')`)
    const failed = (await notes(na.id)).filter((n) => n.eventKey === 'calc.failed')
    await closeBell()
    await p.type('#in-loadFactor', 100)
    await p.click('button', '평가 실행')
    await p.wait(2500)
    const after = (await notes(na.id)).filter((n) => n.eventKey === 'calc.failed' && !n.resolvedAt)
    expect(shown && failed.length === 1 && failed[0].message.ko.includes('loadFactor') && after.length === 0, { shown, n: failed.length, after: after.length })
  })

  await test('T27', '서버 연결 실패 → 복구 시 끊김(긴급)·복구(정상) 이력 기록', async () => {
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/health/*' }] })
    const off = p.on((m) => m.method === 'Fetch.requestPaused' && p.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionRefused' }))
    await p.go(`${BASE}/dashboard`, 2500)
    await p.wait(800)
    await openBell()
    const pending = await p.ev(`${panelText}.includes('연결되면 알림 이력에 기록')`)
    await closeBell()
    off()
    await p.send('Fetch.disable')
    await p.click('button', '지금 점검')
    await p.wait(2500)
    const sys = (await notes(na.id)).filter((n) => n.eventKey.startsWith('sys.server_down'))
    const latest = sys.filter((n) => Date.now() - new Date(n.createdAt).getTime() < 120000)
    expect(pending && latest.some((n) => n.severity === 'CRITICAL' && n.resolvedAt) && latest.some((n) => n.severity === 'SUCCESS'), { pending, latest: latest.map((n) => n.severity) })
  })

  await test('T28', '읽음 처리 후에도 미해결 유지 · 새로고침 후 알림·읽음 상태 유지', async () => {
    await p.go(`${BASE}/dashboard`, 3000)
    await openBell()
    await p.click('#notification-center [data-notification="data.missing_required"] button', '읽음')
    await p.wait(600)
    await p.send('Page.reload')
    await p.wait(3000)
    const n = (await notes(na.id)).find((x) => x.eventKey === 'data.missing_required')
    const onDashboard = await p.ev(`document.body.innerText.includes('현재 주의사항') && [...document.querySelectorAll('li')].some(li => li.innerText.includes('필수 데이터') && li.innerText.includes('미수신'))`)
    await openBell()
    await p.click('#notification-center [role=tab]', '읽지 않음')
    await p.wait(300)
    const hiddenInUnread = await p.ev(`!document.querySelector('#notification-center [data-notification="data.missing_required"]')`)
    await p.click('#notification-center [role=tab]', '전체')
    await closeBell()
    expect(n.readAt && !n.resolvedAt && onDashboard && hiddenInUnread, { read: n.readAt, resolved: n.resolvedAt, onDashboard, hiddenInUnread })
  })

  await test('T29', '케이스를 바꾸면 그 케이스의 알림만 (시스템 알림은 공통)', async () => {
    await p.api('/notifications/client-event/', 'POST', { kind: 'calc_failed', case: na.id, fields: ['capacityMW'] })
    await p.go(`${BASE}/dashboard`, 3000)
    await openBell()
    const inA = await p.ev(`${panelText}.includes('계산 실패')`)
    await closeBell()
    await selectCase(nb.id)
    await p.wait(1500)
    await openBell()
    const inB = await p.ev(`${panelText}.includes('계산 실패')`)
    const sysInB = await p.ev(`${panelText}.includes('서버 연결')`)
    await closeBell()
    await selectCase(na.id)
    await p.wait(1000)
    expect(inA && !inB && sysInB, { inA, inB, sysInB })
  })

  await test('T30', "알림의 'AI에게 설명 요청' → Floating AI 에 알림·화면 데이터 첨부 → 질문에 사용", async () => {
    setSettings({ ai_external_enabled: false })
    await p.go(`${BASE}/dashboard`, 3000)
    await openBell()
    await p.click('#notification-center [data-notification="data.missing_required"] button', 'AI에게 설명 요청')
    const attached = await p.until(`(document.querySelector('#copilot')?.innerText ?? '').includes('알림 + 화면 데이터 첨부') && document.querySelector('textarea[aria-label="AI에게 질문"]').value.includes('데이터')`, 6000)
    await p.click('button[aria-label="전송"]')
    await p.until(`(document.querySelector('#copilot')?.innerText ?? '').includes('답변을 만들지 않았습니다')`, 120000)
    await p.wait(500)
    const conv = (await p.api(`/cases/${na.id}/conversations/`)).items[0]
    const msgs = (await p.api(`/conversations/${conv.id}/`)).messages
    const ctx = msgs[msgs.length - 1].payload.context
    await p.click('button[aria-label="닫기"]')
    expect(attached && ctx?.page === 'checklist' && ctx.lines[0].startsWith('notification [WARNING, DATA'), { attached, page: ctx?.page, first: ctx?.lines?.[0]?.slice(0, 60) })
  })

  await test('T31', '모바일(390px)·다크 모드: 알림 센터 전체 화면, 필터·닫기', async () => {
    await p.size(390, 844, true)
    await useCase(na.id, { theme: 'dark' })
    await p.go(`${BASE}/checklist`, 3000)
    await openBell()
    const g = await p.ev(`(()=>{const c=document.querySelector('#notification-center').getBoundingClientRect(); return {w: Math.round(c.width), h: Math.round(c.height), bg: getComputedStyle(document.querySelector('#notification-center')).backgroundColor}})()`)
    await p.click('#notification-center button[aria-pressed]', '데이터 관리')
    await p.wait(300)
    const onlyData = await p.ev(`[...document.querySelectorAll('#notification-center [data-notification]')].every(e => e.dataset.notification.startsWith('data.'))`)
    await p.click('#notification-center button[aria-label="닫기"]')
    const closed = await p.until(`!document.querySelector('#notification-center')`, 3000)
    await p.size(1440, 1200)
    await useCase(na.id)
    expect(g.w === 390 && g.h >= 800 && g.bg !== 'rgb(255, 255, 255)' && onlyData && closed, { g, onlyData, closed })
  })

  // ------------------------------------------------------------------ 추천 질문
  const sq = await newCase('E2E 추천 질문')
  await useCase(sq.id)
  setSettings({ ai_external_enabled: false })
  await p.ev(`localStorage.removeItem('hrsgx.copilot')`)
  const cp = `(document.querySelector('#copilot')?.innerText ?? '')`
  const tabSel = (id) => `document.querySelector('#copilot #sg-tab-${id}')?.getAttribute('aria-selected') === 'true'`

  await test('T32', '추천 질문: 4개 카테고리 탭(기본 열역학), 탭 전환·선택 유지, 언어 전환 시 질문도 영어로', async () => {
    await p.go(`${BASE}/reference`, 2500)
    await p.click('[data-copilot-fab] button')
    await p.until(`!!document.querySelector('#copilot [data-suggestions]')`, 4000)
    const tabs = await p.ev(`document.querySelectorAll('#copilot [role=tab]').length`)
    const def = await p.ev(tabSel('thermo'))
    const thermo = await p.ev(`[...document.querySelectorAll('#copilot #sg-panel [data-suggestion]')].map(b => b.dataset.suggestion).join(',')`)
    await p.click('#copilot [role=tab]', '세정 공법')
    const cleaning = await p.ev(`[...document.querySelectorAll('#copilot #sg-panel [data-suggestion]')].map(b => b.dataset.suggestion).join(',')`)
    await p.click('button[aria-label="닫기"]')
    await p.click('[data-copilot-fab] button')
    await p.wait(300)
    const kept = await p.ev(tabSel('cleaning'))
    await p.click('button', 'EN')
    await p.wait(300)
    const english = await p.ev(`${cp}.includes('How do dry-ice, high-pressure water and chemical cleaning differ?')`)
    await p.click('button', 'KO')
    await p.click('button[aria-label="닫기"]')
    expect(tabs === 4 && def && thermo === 'thermo-1,thermo-2,thermo-3,thermo-4' && cleaning === 'cleaning-1,cleaning-2,cleaning-3,cleaning-4' && kept && english,
      { tabs, def, thermo, cleaning, kept, english })
  })

  await test('T33', '추천 질문 클릭 → 바로 사용자 메시지·실제 검색 답변, 연속 클릭해도 1번만 전송, 대화 중에는 접힘·다시 열기', async () => {
    await p.go(`${BASE}/reference`, 2500)
    await p.click('[data-copilot-fab] button')
    await p.click('#copilot [role=tab]', '핀치')
    await p.ev(`(()=>{const b=document.querySelector('#copilot [data-suggestion="pinch-1"]'); b.click(); b.click(); b.click()})()`)
    const pendingShown = await p.until(`!!document.querySelector('#copilot [data-pending]')`, 2000)
    await p.until(`${cp}.includes('답변을 만들지 않았습니다')`, 120000)
    await p.wait(500)
    const conv = (await p.api(`/cases/${sq.id}/conversations/`)).items
    const msgs = conv.length ? (await p.api(`/conversations/${conv[0].id}/`)).messages : []
    const collapsed = await p.ev(`!document.querySelector('#copilot [data-suggestions]') && ${cp}.includes('추천 질문 보기')`)
    await p.click('#copilot button[aria-expanded]', '추천 질문 보기')
    const reopened = await p.until(`!!document.querySelector('#copilot [data-suggestions]')`, 2000)
    await p.click('button[aria-label="새 대화"]')
    const fresh = await p.until(`${cp}.includes('논문 근거로 답하는') && !!document.querySelector('#copilot [data-suggestions]')`, 2000)
    await p.click('button[aria-label="닫기"]')
    expect(pendingShown && conv.length === 1 && msgs.length === 2 && msgs[0].text.includes('Pinch Point와 Approach Point') && msgs[1].payload.evidence.length > 0 && collapsed && reopened && fresh,
      { pendingShown, conv: conv.length, msgs: msgs.length, collapsed, reopened, fresh })
  })

  await test('T34', '현재 화면 맞춤 질문: 계산 결과가 없으면 보내지 않고 안내, 계산 후에는 화면 데이터와 함께 전송', async () => {
    await p.go(`${BASE}/simulation`, 3000)
    await p.click('[data-copilot-fab] button')
    await p.click('button[aria-label="새 대화"]')
    await p.until(`${cp}.includes('필요한 데이터 없음')`, 4000)
    const before = (await p.api(`/cases/${sq.id}/conversations/`)).items.length
    await p.click('#copilot [data-suggestion="sim-1"]')
    const notice = await p.until(`${cp}.includes('질문은 보내지 않았습니다')`, 2000)
    await p.wait(800)
    const stillNone = (await p.api(`/cases/${sq.id}/conversations/`)).items.length === before
    await p.click('button[aria-label="닫기"]')
    await p.click('button', '평가 실행')
    await p.wait(2500)
    await p.click('[data-copilot-fab] button')
    await p.until(`!${cp}.includes('필요한 데이터 없음') && !${cp}.includes('확인 중')`, 5000)
    await p.click('#copilot [data-suggestion="sim-1"]')
    await p.until(`${cp}.includes('답변을 만들지 않았습니다')`, 120000)
    await p.wait(500)
    const conv = (await p.api(`/cases/${sq.id}/conversations/`)).items[0]
    const msgs = (await p.api(`/conversations/${conv.id}/`)).messages
    const ctx = msgs[msgs.length - 1].payload.context
    await p.click('button[aria-label="닫기"]')
    expect(notice && stillNone && ctx?.page === 'simulation' && ctx.lines.some((x) => x.includes('output loss')), { notice, stillNone, page: ctx?.page })
  })

  await test('T35', '추천 질문: 확장 패널·모바일 전체 화면(탭 가로 스크롤)·다크 모드', async () => {
    await p.go(`${BASE}/dashboard`, 3000)
    await p.click('[data-copilot-fab] button')
    await p.click('button[aria-label="새 대화"]')
    await p.click('button[aria-label="사이드 패널로 확장"]')
    const inPanel = await p.until(`document.querySelector('#copilot')?.dataset.copilot === 'panel' && !!document.querySelector('#copilot [data-suggestions]') && ${cp}.includes('이 화면 맞춤 질문')`, 3000)
    await p.click('button[aria-label="작은 창으로"]')
    await p.click('button[aria-label="닫기"]')
    await p.size(390, 844, true)
    await useCase(sq.id, { theme: 'dark' })
    await p.go(`${BASE}/checklist`, 3000)
    await p.click('[data-copilot-fab] button')
    await p.click('button[aria-label="새 대화"]')
    await p.wait(600)
    const m = await p.ev(`(()=>{const t=document.querySelector('#copilot [role=tablist]'); const c=document.querySelector('#copilot').getBoundingClientRect(); const q=document.querySelector('#copilot [data-suggestion]'); return {w: Math.round(c.width), scroll: getComputedStyle(t).overflowX, qw: Math.round(q.getBoundingClientRect().width), bg: getComputedStyle(q).backgroundColor}})()`)
    await p.click('button[aria-label="닫기"]')
    await p.size(1440, 1200)
    await useCase(sq.id)
    expect(inPanel && m.w === 390 && m.scroll === 'auto' && m.qw > 300 && m.bg !== 'rgb(255, 255, 255)', { inPanel, m })
  })

  // ------------------------------------------------------------------ 로그인 · 역할별 접근 제어
  // PC 화면에는 좁은/넓은 사이드바가 함께 있고 하나만 보임 → 보이는 것만 셈
  const sideItems = `[...document.querySelectorAll('aside nav a')].filter(a => a.offsetParent).map(a => a.textContent.trim())`
  const sideGroups = `[...document.querySelectorAll('aside nav > div > div:first-child')].filter(d => d.offsetParent).map(d => d.textContent.trim()).filter(Boolean)`
  const logoutUi = async () => {
    await p.click('[data-account]')
    await p.wait(300)
    await p.click('[data-logout]')
    return p.until(`location.pathname === '/login'`, 6000)
  }

  await test('A01', '로그인 화면: 라벨·비밀번호 표시 전환·엔터 제출·실패 문구(사번 존재 여부 구분 없음)', async () => {
    const out = await logoutUi()
    const ui = await p.ev(`({ emp: !!document.querySelector('label[for=login-emp]') && !!document.getElementById('login-emp'), pw: document.getElementById('login-pw').type,
      roleChoice: document.body.innerText.includes('역할 선택') || !!document.querySelector('input[type=radio]'), focus: document.activeElement?.id })`)
    await p.click('button[aria-label="비밀번호 표시"]')
    const shown = await p.ev(`document.getElementById('login-pw').type`)
    await p.click('button[aria-label="비밀번호 숨기기"]')
    const msgs = []
    for (const emp of [acc.plant.employee_id, 'no-such-emp']) {
      await p.type('#login-emp', emp)
      await p.type('#login-pw', 'wrong-password')
      await p.ev(`document.getElementById('login-pw').focus()`)
      await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
      await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await p.until(`!!document.querySelector('[data-login-error]')`, 5000)
      msgs.push(await p.ev(`document.querySelector('[data-login-error]').innerText.trim()`))
    }
    expect(out && ui.emp && ui.pw === 'password' && !ui.roleChoice && ui.focus === 'login-emp' && shown === 'text' && msgs[0] === msgs[1] && msgs[0].includes('사번 또는 비밀번호를 확인해 주세요'), { out, ui, shown, msgs })
  })

  await test('A02', '비로그인: 업무 화면은 로그인으로, 업무 API 는 401', async () => {
    await p.go(`${BASE}/checklist`, 2500)
    const redirected = await p.ev(`location.pathname === '/login' && location.search.includes('next=%2Fchecklist')`)
    const apis = await p.ev(`Promise.all(['/api/cases/', '/api/rag/experiments/', '/api/knowledge/papers/', '/api/glossary/'].map(u => fetch(u).then(r => r.status)))`)
    expect(redirected && apis.every((x) => x === 401), { redirected, apis })
  })

  await test('A03', '로그인 후 원래 화면으로 (허용된 주소만) · 플랜트 메뉴 7개·그룹 3개', async () => {
    await p.go(`${BASE}/analysis?tab=pinch`, 2000)
    await p.type('#login-emp', acc.plant.employee_id)
    await p.type('#login-pw', acc.plant.password)
    await p.ev(`document.querySelector('form button[type=submit]').click()`)
    const back = await p.until(`location.pathname === '/analysis' && location.search === '?tab=pinch' && [...document.querySelectorAll('aside nav a')].some(a => a.offsetParent)`, 10000)
    const items = await p.ev(sideItems)
    const groups = await p.ev(sideGroups)
    const role = await p.ev(`(document.querySelector('[data-account]')?.innerText ?? '') + (document.querySelector('header')?.innerText ?? '')`)
    const want = ['대시보드', '데이터 요청 체크리스트', '시뮬레이션', '심층 분석', '세정 전후 비교', 'AI 엔지니어링 도우미', '참고 자료 및 용어집']
    expect(back && JSON.stringify(items) === JSON.stringify(want) && JSON.stringify(groups) === JSON.stringify(['OVERVIEW', 'ENGINEERING', 'AI & KNOWLEDGE']) && role.includes('플랜트 엔지니어'), { back, items, groups })
  })

  await test('A04', '플랜트: RAG·계산기·설정 화면 직접 접근 → 접근 불가 안내 + 시작 화면 버튼, RAG API 403', async () => {
    const seen = {}
    for (const path of ['rag-evaluation', 'knowledge-base', 'calculator', 'settings']) {
      await p.go(`${BASE}/${path}`, 2000)
      seen[path] = await p.ev(`!!document.querySelector('[data-access-denied]') && !document.body.innerText.includes('공식 평가셋 v1 실험 기록')`)
    }
    await p.click('[data-access-denied] a', '내 시작 화면으로')
    const home = await p.until(`location.pathname === '/dashboard'`, 4000)
    const api = await p.ev(`Promise.all(['/api/rag/experiments/', '/api/knowledge/papers/', '/api/rag/labels/'].map(u => fetch(u).then(r => r.status)))`)
    expect(Object.values(seen).every(Boolean) && home && api.every((x) => x === 403), { seen, home, api })
  })

  await test('A05', '브라우저 값·요청 변조로 권한 상승 불가', async () => {
    await p.ev(`localStorage.setItem('role', 'AI_ADMIN'); localStorage.setItem('hrsgx.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('hrsgx.prefs') || '{}'), role: 'AI_ADMIN' }))`)
    await p.go(`${BASE}/rag-evaluation`, 2500)
    const denied = await p.ev(`!!document.querySelector('[data-access-denied]')`)
    const api = await p.ev(`fetch('/api/rag/experiments/?role=AI_ADMIN', { headers: { 'X-Role': 'AI_ADMIN' } }).then(r => r.status)`)
    await p.ev(`localStorage.removeItem('role')`)
    expect(denied && api === 403, { denied, api })
  })

  await test('A06', '플랜트 로그아웃 → AI 관리자 로그인: 이전 상태 제거, RAG 메뉴 2개만, 플랜트 화면·API 차단, 조회 전용', async () => {
    await p.go(`${BASE}/dashboard`, 2500)
    await p.ev(`localStorage.setItem('hrsgx.copilot', JSON.stringify({ lastByCase: { 1: 1 } }))`)
    await logoutUi()
    const cleared = await p.ev(`!localStorage.getItem('hrsgx.copilot') && !('currentCaseId' in JSON.parse(localStorage.getItem('hrsgx.prefs') || '{}'))`)
    await p.type('#login-emp', acc.admin.employee_id)
    await p.type('#login-pw', acc.admin.password)
    await p.ev(`document.querySelector('form button[type=submit]').click()`)
    const landed = await p.until(`location.pathname === '/rag-evaluation' && !document.querySelector('[data-boot]')`, 8000)
    await p.wait(1500)
    const items = await p.ev(sideItems)
    const groups = await p.ev(sideGroups)
    const plantBits = await p.ev(`({ caseSel: !!document.querySelector('select[aria-label="평가 케이스 선택"]'), bell: !!document.querySelector('[data-bell]'), fab: !!document.querySelector('[data-copilot-fab]') })`)
    const records = await p.until(`/recall/i.test(document.body.innerText)`, 8000)
    const writeButtons = await p.ev(`[...document.querySelectorAll('button')].filter(b => /dev 실행|올리고 처리|전체 재색인|재임베딩/.test(b.textContent)).length`)
    await p.go(`${BASE}/knowledge-base`, 2500)
    const kb = await p.ev(`!document.querySelector('[data-access-denied]') && document.body.innerText.includes('47')`)
    await p.go(`${BASE}/dashboard`, 2000)
    const denied = await p.ev(`!!document.querySelector('[data-access-denied]')`)
    const api = await p.ev(`Promise.all(['/api/cases/', '/api/glossary/', '/api/notifications/'].map(u => fetch(u).then(r => r.status)))`)
    expect(cleared && landed && JSON.stringify(items) === JSON.stringify(['RAG 지식베이스', 'RAG 검색 성능 평가']) && JSON.stringify(groups) === JSON.stringify(['RAG 관리'])
      && !plantBits.caseSel && !plantBits.bell && !plantBits.fab && records && writeButtons === 0 && kb && denied && api.every((x) => x === 403),
      { cleared, landed, items, groups, plantBits, records, writeButtons, kb, denied, api })
  })

  await test('A07', '로그인 만료(서버 세션 없음) → 다음 요청에서 로그인 화면 + 만료 안내, 새로고침 시 로그인 유지', async () => {
    await p.loginAs(BASE, acc.plant, '/dashboard')
    await p.send('Page.reload')
    await p.wait(2500)
    const kept = await p.ev(`location.pathname === '/dashboard' && !!document.querySelector('[data-account]')`)
    await p.send('Network.enable')
    await p.send('Network.deleteCookies', { name: 'sessionid', url: BASE })
    await p.click('aside nav a', '데이터 요청 체크리스트')
    const expired = await p.until(`location.pathname === '/login' && document.body.innerText.includes('로그인이 만료되었습니다')`, 8000)
    expect(kept && expired, { kept, expired })
  })

  await test('A08', '화면 폭 390px: 로그인 폼 중심 화면, 로그인 후 햄버거 메뉴에 역할 메뉴', async () => {
    await p.size(390, 844, true)
    await p.go(`${BASE}/login`, 2000)
    const form = await p.ev(`(()=>{const f=document.querySelector('form').getBoundingClientRect(); return { w: Math.round(f.width), over: document.documentElement.scrollWidth > innerWidth }})()`)
    await p.type('#login-emp', acc.plant.employee_id)
    await p.type('#login-pw', acc.plant.password)
    await p.ev(`document.querySelector('form button[type=submit]').click()`)
    await p.until(`location.pathname === '/dashboard' && !document.querySelector('[data-boot]')`, 8000)
    await p.click('button[aria-label="메뉴 열기"]')
    await p.wait(500)
    const items = await p.ev(`[...document.querySelectorAll('[role=dialog] nav a')].map(a => a.textContent.trim())`)
    await p.size(1440, 1200)
    expect(form.w >= 300 && !form.over && items.length === 7 && !items.some((x) => /RAG|계산기|설정/.test(x)), { form, items })
  })

  await test('A09', '플랜트 챗봇: 답변·출처는 오되 검색 점수·내부 설정은 응답에 없음', async () => {
    await p.go(`${BASE}/dashboard`, 2000)
    const cs = (await p.api('/cases/')).items
    const conv = await p.api(`/cases/${c.id}/conversations/`, "POST", {})
    const r = await p.api(`/conversations/${conv.id}/messages/`, 'POST', { question: 'pinch point definition' })
    const ev = r.assistant.payload.evidence
    const info = await p.api('/rag/info/')
    await p.api(`/conversations/${conv.id}/`, 'DELETE')
    expect(ev.length > 0 && ev.every((e) => e.title && !('bm25_score' in e) && !('cosine' in e) && !('rrf' in e)) && !('timing' in r.assistant.payload) && !('configs' in info),
      { n: ev.length, keys: Object.keys(ev[0] || {}), info: Object.keys(info) })
  })
} finally {
  await p.loginAs(BASE, acc.plant, '/dashboard').catch(() => null) // 정리(케이스 삭제)는 플랜트 권한으로
  for (const id of created) await p.api(`/cases/${id}/`, 'DELETE').catch(() => null)
  try { cleanupE2eCases(created) } catch (e) { console.error('임시 케이스 정리 실패:', e.message) }
  setSettings({ ai_external_enabled: settingsBefore.ai_external_enabled, sensitive_terms: settingsBefore.sensitive_terms })
  await p.ev(`localStorage.removeItem('hrsgx.prefs')`).catch(() => null)
  await p.close()
  deleteE2eAccounts()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과${failed.length ? ` · 실패 ${failed.map((r) => r.id).join(', ')}` : ''} · 임시 케이스 ${created.length}개 삭제`)
const out = join(tmpdir(), 'hrsgx-e2e-result.json')
writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), base: BASE, results }, null, 1))
console.log(`기록: ${out}`)
process.exit(failed.length ? 1 : 0)
