// 모바일 웹 화면 테스트 — 휴대폰 접속용 서버(localhost:5175)에서 휴대폰 크기(390×844)로 실행합니다.
// PC 화면(5174)과 같은 서버·DB 를 쓰므로, 모바일에서 바꾼 값이 PC 화면에 보이는지도 함께 확인합니다.
// 실행: 백엔드(8002) + npm run dev(5174) + npm run dev:mobile(5175) 를 켠 뒤 npm run e2e:mobile
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupE2eCases, createE2eAccounts, deleteE2eAccounts, getSettings, setSettings } from './backend.mjs'
import { launch } from './browser.mjs'

const M = process.env.E2E_MOBILE_BASE || 'http://localhost:5175'
const PC = process.env.E2E_BASE || 'http://localhost:5174'
const results = []
const created = []
let p

function expect(ok, detail) {
  if (!ok) throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300))
}
async function test(id, name, fn) {
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
const phone = () => p.size(390, 844, true)
const prefs = (cid, extra = {}) => p.ev(`localStorage.setItem('hrsgx.prefs', JSON.stringify(${JSON.stringify({ lang: 'ko', currentCaseId: cid, ...extra })})); localStorage.removeItem('hrsgx.ui')`)
const sheet = `(document.querySelector('[data-sheet]')?.innerText ?? '')`
// PC 주소(5174)와 휴대폰 주소(5175)는 브라우저 저장소가 따로라, PC 화면에서도 같은 케이스를 고른 뒤 확인합니다.
const openPc = async (path, cid) => {
  await p.size(1440, 1000)
  await p.go(`${PC}${path}`, 800)
  await prefs(cid)
  await p.go(`${PC}${path}`, 3000)
}

p = await launch()
await phone()
await p.go(`${M}/dashboard`, 1500)
const health = await p.api('/health/')
if (health.http !== 200) {
  console.error('서버가 응답하지 않습니다. 백엔드(8002)와 휴대폰 접속용 서버(npm run dev:mobile, 5175)를 먼저 켜세요.')
  await p.close()
  process.exit(2)
}
const settingsBefore = getSettings()
setSettings({ ai_external_enabled: false }) // 외부 전송 없이 근거 검색 모드로 검사
const acc = createE2eAccounts() // 테스트 전용 임시 계정 (끝나면 삭제)
if (!(await p.loginAs(M, acc.plant, '/dashboard'))) {
  console.error('테스트 계정으로 로그인하지 못했습니다.')
  deleteE2eAccounts()
  await p.close()
  process.exit(2)
}
console.log(`HRSG Explorer 모바일 화면 테스트 — ${M} (390×844, 플랜트 엔지니어로 로그인)\n`)

const c = await p.api('/cases/', 'POST', { name: 'E2E 모바일 — 이름이 아주 긴 평가 케이스 (헤더 축약 확인)' })
created.push(c.id)
await p.api(`/cases/${c.id}/evaluate/all/`, 'POST')
await prefs(c.id)

try {
  await test('M01', '모바일 홈: 운전 상태·핵심 KPI 4개·확인할 항목·빠른 작업, 하단 메뉴 4개', async () => {
    await p.go(`${M}/dashboard`, 3500)
    const r = await p.ev(`({ mobile: !!document.querySelector('[data-mobile-ui]'), status: !!document.querySelector('[data-home-status]'),
      kpis: [...document.querySelectorAll('[data-mkpi]')].map(e => e.dataset.mkpi).join(','), tabs: document.querySelectorAll('[data-bottom-nav] a').length,
      attention: document.body.innerText.includes('현재 확인할 항목'), quick: document.body.innerText.includes('데이터 점검하기'), demo: document.body.innerText.includes('가상 운전 상태') })`)
    expect(r.mobile && r.status && r.kpis === 'backPressure,stackTemp,lossMW,readiness' && r.tabs === 4 && r.attention && r.quick && r.demo, r)
  })

  await test('M02', 'KPI 카드 수치·단위가 잘리지 않고 가로 넘침 없음 (작은 폰 320px 포함)', async () => {
    const bad = []
    for (const w of [320, 390]) {
      await p.size(w, 800, true)
      await p.wait(400)
      const r = await p.ev(`({ over: document.documentElement.scrollWidth > innerWidth,
        cut: [...document.querySelectorAll('[data-mkpi] *')].filter(e => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => e.textContent).slice(0, 3) })`)
      if (r.over || r.cut.length) bad.push({ w, ...r })
    }
    await phone()
    expect(bad.length === 0, bad)
  })

  await test('M03', '하단 메뉴: 홈·알림·점검·AI 이동, 전체 메뉴에서 나머지 화면', async () => {
    const seen = []
    for (const [label, path] of [['알림', '/notifications'], ['점검', '/checklist'], ['AI', '/ai-assistant'], ['홈', '/dashboard']]) {
      await p.click('[data-bottom-nav] a', label)
      await p.wait(700)
      seen.push(await p.ev(`location.pathname === '${path}' && document.querySelector('[data-bottom-nav] a[aria-current=page]')?.textContent.includes('${label}')`))
    }
    await p.click('button[aria-label="전체 메뉴"]')
    await p.wait(400)
    // 플랜트 전체 메뉴: 하단 탭 외 허용 화면만 (계산기·설정·RAG 없음) + 계정·로그아웃
    const menu = await p.ev(`${sheet}.includes('시뮬레이션') && ${sheet}.includes('참고 자료') && ${sheet}.includes('로그아웃') && !${sheet}.includes('계산기') && !${sheet}.includes('RAG') && !${sheet}.includes('데이터 요청 체크리스트')`)
    await p.click('[data-sheet] button', '시뮬레이션')
    await p.wait(1500)
    const sim = await p.ev(`location.pathname === '/simulation' && !!document.querySelector('[data-mobile-ui]')`)
    expect(seen.every(Boolean) && menu && sim, { seen, menu, sim })
  })

  await test('M04', '알림 카드 → 상세(관련 수치·발생 조건·확인 사항) → 관련 화면 이동', async () => {
    await p.go(`${M}/notifications`, 2500)
    await p.click('[data-alert="data.missing_required"]')
    await p.until(`!!document.querySelector('[data-alert-detail]')`, 3000)
    const detail = await p.ev(`${sheet}.includes('관련 수치') && ${sheet}.includes('발생 조건') && ${sheet}.includes('추가 확인 사항') && ${sheet}.includes('미수신 필수')`)
    await p.click('[data-sheet] button', '관련 화면')
    const moved = await p.until(`location.pathname === '/checklist' && !!document.querySelector('[data-item-sheet]')`, 4000)
    await p.click('[data-sheet] button[aria-label="닫기"]')
    const n = (await p.api(`/notifications/?case=${c.id}`)).items.find((x) => x.eventKey === 'data.missing_required')
    expect(detail && moved && n.readAt && !n.resolvedAt, { detail, moved, read: n.readAt, resolved: n.resolvedAt })
  })

  await test('M05', '체크리스트 카드 → 상세 입력 저장 (저장 성공 표시)', async () => {
    await p.go(`${M}/checklist`, 2500)
    await p.click('[data-item="A-02"]')
    await p.until(`!!document.querySelector('[data-item-sheet]')`, 3000)
    await p.type('#m-A-02-value', '345')
    await p.type('[data-item-sheet] input[placeholder^="예: 부하"]', '부하 100%, 외기 14 °C')
    await p.click('[data-save]')
    const toast = await p.until(`[...document.querySelectorAll('[data-toast]')].some(t => t.innerText.includes('저장했습니다'))`, 4000)
    const st = (await p.api(`/cases/${c.id}/checklist/`)).items.find((i) => i.id === 'A-02').state
    const card = await p.ev(`document.querySelector('[data-item="A-02"]')?.innerText.includes('345')`)
    expect(toast && st.value === '345' && st.condition.includes('14') && card, { toast, value: st.value, card })
  })

  await test('M06', '모바일에서 입력한 값이 PC 화면에 그대로 보임 (같은 서버·DB)', async () => {
    await openPc('/checklist', c.id)
    const row = await p.ev(`[...document.querySelectorAll('tr')].find(tr => tr.innerText.includes('A-02'))?.innerText ?? ''`)
    const pcLayout = await p.ev(`!document.querySelector('[data-mobile-ui]') && !!document.querySelector('aside')`)
    await phone()
    expect(row.includes('345') && pcLayout, { row: row.slice(0, 80), pcLayout })
  })

  await test('M07', '동시 수정 감지: 다른 기기가 먼저 저장하면 덮어쓰지 않고 안내', async () => {
    await p.go(`${M}/checklist`, 2500)
    await p.click('[data-item="A-03"]')
    await p.until(`!!document.querySelector('[data-item-sheet]')`, 3000)
    await p.wait(1100) // 수정 시각이 확실히 달라지게
    await p.api(`/cases/${c.id}/checklist/`, 'PATCH', { updates: [{ id: 'A-03', value: '4.4' }] }) // PC 에서 먼저 저장
    await p.type('#m-A-03-value', '9.9')
    await p.click('[data-save]')
    const warned = await p.until(`${sheet}.includes('먼저 수정했습니다')`, 4000)
    const v = (await p.api(`/cases/${c.id}/checklist/`)).items.find((i) => i.id === 'A-03').state.value
    await p.click('[data-sheet] button[aria-label="닫기"]')
    expect(warned && v === '4.4', { warned, v })
  })

  await test('M08', '현장 사진: 카메라·사진 선택으로 올리기 → 미리보기, 형식 검사, 삭제', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hrsgx-photo-'))
    const jpg = join(dir, 'site.jpg')
    writeFileSync(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]))
    const fake = join(dir, 'fake.jpg')
    writeFileSync(fake, '<html>not a photo</html>')
    await p.go(`${M}/checklist`, 2500)
    await p.click('[data-item="A-04"]')
    await p.until(`!!document.querySelector('[data-photo-input]')`, 3000)
    await p.setFile('[data-photo-input]', jpg)
    const shown = await p.until(`document.querySelectorAll('[data-item-sheet] img').length === 1`, 5000)
    await p.setFile('[data-photo-input]', fake)
    const rejected = await p.until(`${sheet}.includes('JPEG·PNG·WEBP·HEIC 사진만')`, 5000)
    const list = (await p.api(`/cases/${c.id}/checklist/A-04/attachments/`)).items
    const file = await p.ev(`fetch('${list[0]?.url}').then(r => r.headers.get('content-type'))`)
    await p.api(`/attachments/${list[0].id}/`, 'DELETE')
    await p.click('[data-sheet] button[aria-label="닫기"]')
    expect(shown && rejected && list.length === 1 && file === 'image/jpeg', { shown, rejected, n: list.length, file })
  })

  await test('M09', '자료 요청 초안: 요청 필요 항목으로 만들고 복사·공유 버튼 (발송 없음)', async () => {
    await p.api(`/cases/${c.id}/checklist/`, 'PATCH', { updates: [{ id: 'B-01', supply_status: 'REQUEST_NEEDED' }] })
    await p.go(`${M}/checklist`, 2500)
    await p.click('button', '자료 요청')
    const ok = await p.until(`${sheet}.includes('스택') && ${sheet}.includes('메일을 보내지 않습니다') && [...document.querySelectorAll('[data-sheet] button')].some(b => b.textContent.includes('공유'))`, 5000)
    await p.click('[data-sheet] button[aria-label="닫기"]')
    expect(ok, '초안·복사·공유가 보이지 않음')
  })

  await test('M10', 'AI 탭: 열었던 화면 맞춤 질문 → 추천 질문 선택 → 근거 답변 + 논문 원문 펼치기', async () => {
    await p.go(`${M}/checklist`, 2000)
    await p.click('[data-bottom-nav] a', 'AI')
    await p.until(`!!document.querySelector('[data-mobile-ai]')`, 3000)
    await p.click('button[aria-label="새 대화"]')
    const origin = await p.until(`document.querySelector('[data-origin-card]')?.innerText.includes('현장 점검') && !!document.querySelector('[data-suggestion="ck-1"]')`, 3000)
    await p.click('[data-suggestion="thermo-1"]')
    await p.until(`document.body.innerText.includes('답변을 만들지 않았습니다')`, 120000)
    await p.click('[data-mobile-ai] button[aria-expanded]', '참고 문헌')
    await p.wait(300)
    const cards = await p.ev(`document.querySelectorAll('[data-mobile-ai] ol > li').length`)
    await p.click('[data-mobile-ai] ol > li button[aria-expanded]')
    await p.wait(300)
    const passage = await p.ev(`(document.querySelector('[data-mobile-ai] ol > li p')?.innerText.length ?? 0) > 40`)
    expect(origin && cards >= 1 && cards <= 8 && passage, { origin, cards, passage })
  })

  await test('M11', '대화 기록 공유: 모바일 대화가 PC AI 화면에, PC 대화가 모바일 기록에', async () => {
    const conv = (await p.api(`/cases/${c.id}/conversations/`)).items[0]
    await openPc('/ai-assistant', c.id)
    const onPc = await p.ev(`document.body.innerText.includes(${JSON.stringify(conv.title.slice(0, 15))})`)
    const pcConv = await p.api(`/cases/${c.id}/conversations/`, 'POST', { title: 'PC에서 만든 대화' })
    await phone()
    await p.go(`${M}/ai-assistant`, 2500)
    await p.click('button[aria-label="대화 기록"]')
    const onMobile = await p.until(`${sheet}.includes('PC에서 만든 대화')`, 4000)
    await p.click('[data-sheet] button[aria-label="닫기"]')
    expect(onPc && onMobile && pcConv.id, { onPc, onMobile })
  })

  await test('M12', '계산기(플랜트 메뉴 아님)는 접근 불가, 입력이 바뀌면 홈에 재평가 필요 표시', async () => {
    await p.go(`${M}/calculator`, 3000)
    const first = await p.ev(`!!document.querySelector('[data-access-denied]')`)
    const snap = (await p.api(`/cases/${c.id}/snapshots/`, 'POST', { label: 'E2E 스냅샷' })).http === 201 // 결과 저장은 서버에서 그대로 가능
    const inputs = await p.api(`/cases/${c.id}/inputs/`)
    await p.api(`/cases/${c.id}/inputs/`, 'PUT', { mode: inputs.mode, scenario: 'CUSTOM', values: { ...inputs.values, currentBP: 380 } })
    const stale = (await p.api(`/cases/${c.id}/results/`)).results.performance.stale
    await p.go(`${M}/dashboard`, 3000)
    const homeStale = await p.ev(`document.body.innerText.includes('재평가 필요')`)
    await p.api(`/cases/${c.id}/evaluate/all/`, 'POST')
    expect(first && snap && stale && homeStale, { first, snap, stale, homeStale })
  })

  await test('M13', '네트워크 끊김: 연결 없음 안내 + 마지막 값 유지(오래된 값 표시), 복구', async () => {
    await p.go(`${M}/dashboard`, 3000)
    await p.send('Network.enable')
    await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const banner = await p.until(`document.querySelector('[role=alert]')?.innerText.includes('네트워크 연결 없음')`, 5000)
    const kept = await p.ev(`document.querySelectorAll('[data-mkpi]').length === 4`)
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const back = await p.until(`!document.querySelector('[role=alert]')?.innerText.includes('네트워크 연결 없음')`, 5000)
    expect(banner && kept && back, { banner, kept, back })
  })

  await test('M14', 'DEMO 와 사용자 입력 구분 (헤더 배지·홈 상태 카드·알림 DEMO 표시)', async () => {
    await p.go(`${M}/dashboard`, 3000)
    const demo = await p.ev(`document.querySelector('header')?.innerText.includes('DEMO') && document.body.innerText.includes('가상 운전 상태 (실측 아님)')`)
    const u = await p.api('/cases/', 'POST', { name: 'E2E 모바일 사용자 입력' })
    created.push(u.id)
    const inputs = await p.api(`/cases/${u.id}/inputs/`)
    await p.api(`/cases/${u.id}/inputs/`, 'PUT', { mode: 'USER', scenario: 'CUSTOM', values: inputs.values })
    await prefs(u.id)
    await p.go(`${M}/dashboard`, 3500)
    const user = await p.ev(`document.querySelector('header')?.innerText.includes('입력값') && !document.body.innerText.includes('가상 운전 상태 (실측 아님)')`)
    await prefs(c.id)
    expect(demo && user, { demo, user })
  })

  await test('M15', '입력창이 하단 메뉴에 가리지 않음 (AI·점검 상세)', async () => {
    await p.go(`${M}/ai-assistant`, 2500)
    const ai = await p.ev(`(()=>{const t=document.querySelector('[data-mobile-ai] textarea').getBoundingClientRect(); const n=document.querySelector('[data-bottom-nav]').getBoundingClientRect(); return t.bottom <= n.top + 1 && t.top > 0})()`)
    await p.go(`${M}/checklist`, 2500)
    await p.click('[data-item="A-05"]')
    await p.wait(600)
    const save = await p.ev(`(()=>{const b=document.querySelector('[data-save]').getBoundingClientRect(); return b.bottom <= innerHeight && b.height >= 44})()`)
    await p.click('[data-sheet] button[aria-label="닫기"]')
    expect(ai && save, { ai, save })
  })

  await test('M16', '다크 모드: 배경·카드가 어두운 색, 글자 대비 유지', async () => {
    await prefs(c.id, { theme: 'dark' })
    await p.go(`${M}/dashboard`, 3000)
    const r = await p.ev(`(()=>{const card=document.querySelector('[data-mkpi]'); return {dark: document.documentElement.classList.contains('dark'), bg: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(card).backgroundColor, ink: getComputedStyle(card.querySelector('span')).color}})()`)
    await prefs(c.id)
    expect(r.dark && r.bg !== 'rgb(248, 250, 252)' && r.card !== 'rgb(255, 255, 255)', r)
  })

  await test('M17', '태블릿(820)·PC 폭(1440)에서는 PC 화면, PC 주소(5174)는 좁아도 PC 화면', async () => {
    const r = {}
    for (const w of [820, 1440]) {
      await p.size(w, 1000)
      await p.go(`${M}/dashboard`, 2500)
      r[w] = await p.ev(`!document.querySelector('[data-mobile-ui]') && !!document.querySelector('header')`)
    }
    await phone()
    await p.go(`${PC}/dashboard`, 2500)
    r.pc390 = await p.ev(`!document.querySelector('[data-mobile-ui]')`)
    expect(r[820] && r[1440] && r.pc390, r)
  })

  await test('M18', "'PC 화면으로 보기' ↔ '모바일 화면으로 보기' 전환", async () => {
    await p.go(`${M}/dashboard`, 2500)
    await p.click('button[aria-label="전체 메뉴"]')
    await p.wait(300)
    await p.click('[data-sheet] button', 'PC 화면으로 보기')
    const pc = await p.until(`!document.querySelector('[data-mobile-ui]')`, 3000)
    await p.click('button', '모바일 화면으로 보기')
    const back = await p.until(`!!document.querySelector('[data-mobile-ui]')`, 3000)
    expect(pc && back, { pc, back })
  })

  await test('M19', '케이스 바꾸기: 긴 이름은 헤더에서 줄이고, 목록에서는 전체 이름', async () => {
    await p.go(`${M}/dashboard`, 2500)
    const chip = await p.ev(`(()=>{const s=document.querySelector('[data-case-chip] span.truncate'); return s.scrollWidth > s.clientWidth})()`)
    await p.click('[data-case-chip]')
    await p.wait(300)
    const full = await p.ev(`${sheet}.includes('이름이 아주 긴 평가 케이스 (헤더 축약 확인)')`)
    await p.click('[data-sheet] [role=radio]', 'E2E 모바일 사용자 입력')
    await p.wait(1500)
    const switched = await p.ev(`document.querySelector('[data-case-chip]').innerText.includes('사용자 입력')`)
    await prefs(c.id)
    expect(chip && full && switched, { chip, full, switched })
  })

  await test('M20', 'AI 관리자 모바일: 하단 메뉴 RAG 2개, 플랜트 탭·케이스·알림 없음, 계정 메뉴에서 로그아웃', async () => {
    await p.loginAs(M, acc.admin, '/rag-evaluation')
    await p.wait(1000)
    const tabs = await p.ev(`[...document.querySelectorAll('[data-bottom-nav] a')].map(a => a.textContent.trim())`)
    const plantBits = await p.ev(`({ chip: !!document.querySelector('[data-case-chip]'), bell: !!document.querySelector('header a[href="/notifications"]') })`)
    await p.click('button[aria-label="전체 메뉴"]')
    await p.wait(400)
    const role = await p.ev(`document.querySelector('[data-sheet] [data-account-role]')?.textContent`)
    await p.click('[data-sheet] [data-logout]')
    const out = await p.until(`location.pathname === '/login'`, 6000)
    await p.loginAs(M, acc.plant, '/dashboard')
    await prefs(c.id)
    expect(JSON.stringify(tabs) === JSON.stringify(['RAG 평가', '지식베이스']) && !plantBits.chip && !plantBits.bell && role === 'AI 관리자' && out, { tabs, plantBits, role, out })
  })
} finally {
  for (const id of created) await p.api(`/cases/${id}/`, 'DELETE').catch(() => null)
  try { cleanupE2eCases(created) } catch (e) { console.error('임시 케이스 정리 실패:', e.message) }
  setSettings({ ai_external_enabled: settingsBefore.ai_external_enabled })
  deleteE2eAccounts()
  await p.ev(`localStorage.removeItem('hrsgx.prefs')`).catch(() => null)
  await p.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과${failed.length ? ` · 실패 ${failed.map((r) => r.id).join(', ')}` : ''} · 임시 케이스 ${created.length}개 삭제`)
const out = join(tmpdir(), 'hrsgx-e2e-mobile-result.json')
writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), base: M, results }, null, 1))
console.log(`기록: ${out}`)
process.exit(failed.length ? 1 : 0)
