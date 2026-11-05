// 계산기 키트 README 「기대값」 표 확인 — 실제 화면(PC, 플랜트 엔지니어)에 보이는 글자를 읽어 기대값과 비교합니다.
// 실행: node --experimental-websocket e2e/kit_expected.mjs   (백엔드 8002 · PC 웹 5174 실행 중이어야 함)
// 새 임시 케이스("E2E 키트 기대값")를 만들어 쓰고, 끝나면 지웁니다. 결과 표는 표준 출력과 임시 폴더의 JSON 에 남깁니다.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupE2eCases, createE2eAccounts, deleteE2eAccounts } from './backend.mjs'
import { launch } from './browser.mjs'

const BASE = 'http://localhost:5174'
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '../../backend')
const rows = []
const created = []
const check = (screen, item, expected, actual, ok) => {
  rows.push({ screen, item, expected, actual, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} [${screen}] ${item}\n    기대: ${expected}\n    화면: ${actual}`)
}
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

const p = await launch()
await p.size(1600, 1400)
const acc = createE2eAccounts()
try {
  if (!(await p.loginAs(BASE, acc.plant, '/dashboard'))) throw new Error('로그인 실패')
  const c = await p.api('/cases/', 'POST', { name: 'E2E 키트 기대값' })
  created.push(c.id)
  await p.ev(`localStorage.setItem('hrsgx.prefs', JSON.stringify({ lang: 'ko', currentCaseId: ${c.id} }))`)

  // ───────── 계산기 ─────────
  await p.go(`${BASE}/calculator`, 2500)
  await p.click('button', '기본값 초기화')
  await p.wait(1200)
  await p.click('button', '계산 실행')
  await p.until(`document.querySelectorAll('[data-kpi]').length >= 10 && !document.body.innerText.includes('계산 중')`, 15000)
  await p.wait(600)
  const kpi = await p.ev(`Object.fromEntries([...document.querySelectorAll('[data-kpi]')].map(v => { const card = v.closest('.card'); return [card.querySelector('span').innerText.trim(), (v.innerText + (card.querySelector('.mt-2') ? ' · ' + card.querySelector('.mt-2').innerText : '')).replace(/\\s+/g,' ').trim()] }))`)
  const K = (label) => kpi[label] ?? '(없음)'
  const kpiExp = [
    ['현재 배압', '305.9 mmH₂O', (s) => s.startsWith('305.9') && s.includes('mmH₂O')],
    ['초과 배압', '51.0 mmH₂O', (s) => s.startsWith('51') && s.includes('mmH₂O')],
    ['발전 출력 손실', '1.89 MW', (s) => s.startsWith('1.89') && s.includes('MW')],
    ['월간 발전 손실액', '2.04억 원', (s) => s.startsWith('2.04억 원')],
    ['세정 예상 회수 출력', '1.32 MW', (s) => s.startsWith('1.32') && s.includes('MW')],
    ['세정 투자 비용', '4.46억 원 (드라이아이스 세정)', (s) => s.startsWith('4.46억 원') && s.includes('드라이아이스 세정')],
    ['월간 추가 편익', '1.43억 원', (s) => s.startsWith('1.43억 원')],
    ['순편익 (첫 1개월)', '-3.03억 원', (s) => s.startsWith('-3.03억 원')],
    ['투자 회수기간', '3.12개월', (s) => s.startsWith('3.12')],
    ['손익분기 일수', '93.6일', (s) => s.startsWith('93.6')],
  ]
  for (const [label, exp, ok] of kpiExp) check('KPI 카드 (기본값 초기화)', label, exp, K(label), ok(K(label)))

  const body = await p.text()
  const warn = await p.ev(`[...document.querySelectorAll('div')].filter(d => /보다 큽니다|키트 입력 검사 오류/.test(d.innerText) && d.children.length < 3).map(d => d.innerText).slice(0,3)`)
  check('경고 · 게이지 · 세정 필요도', '경고', '경고 없음', warn.length ? warn.join(' / ') : '경고 없음', warn.length === 0)
  const gauge = await p.ev(`(() => { const g = document.querySelector('svg[role=img][aria-label^="초과 배압"]'); return g ? [...g.querySelectorAll('text')].map(t => t.textContent).join(' | ') : '' })()`)
  check('경고 · 게이지 · 세정 필요도', '배압 상태 게이지', '51.0 / 203.9 mmH₂O, 공개 참고 76.2~101.6', gauge,
    gauge.includes('51') && gauge.includes('203.9') && gauge.includes('76.2~101.6'))
  const idx = await p.ev(`(() => { const el = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('세정 필요도 지수') && c.innerText.includes('/ 100')); return el ? el.innerText : '' })()`)
  const idxLine = norm(idx).match(/세정 필요도 지수.*?온도 기여 [\d.—]+/)?.[0] ?? norm(idx)
  check('경고 · 게이지 · 세정 필요도', '세정 필요도 지수', '41.1 / 100 (배압 33.3 · 온도 7.8)', idxLine,
    /41\.1\s*\/ 100/.test(norm(idx)) && norm(idx).includes('배압 기여 33.3') && norm(idx).includes('온도 기여 7.8'))

  // 배압-손실 곡선: 그래프의 「표로 보기」로 점 값을 읽음
  await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.startsWith('배압-손실 곡선') || c.querySelector('h2,h3')?.innerText.includes('배압-손실 곡선')); [...card.querySelectorAll('button')].find(b => b.innerText.includes('표로 보기')).click() })()`)
  await p.wait(400)
  const curve = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('배압-손실 곡선') && c.querySelector('table')); const trs = [...card.querySelectorAll('tbody tr')]; return [trs[0].innerText, trs[trs.length-1].innerText].map(t => t.replace(/\\s+/g,' ').trim()) })()`)
  check('배압-손실 곡선', '처음 → 끝 점', '초과 0 에서 1.89 MW → 203.9 mmH₂O 에서 5.13 MW', `${curve[0]} → ${curve[1]}`,
    curve[0] === '0 1.89' && curve[1] === '203.9 5.13')

  const bars = async (tab) => {
    await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('세정 공법별 비교')); [...card.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(tab)}).click() })()`)
    await p.wait(400)
    return p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('세정 공법별 비교')); return [...card.querySelector('[role=img]').children].filter(d => d.tagName === 'DIV').map(d => d.innerText.replace(/\\s+/g,' ').trim()) })()`)
  }
  const pay = await bars('회수기간')
  check('공법 비교 (기본값)', '회수기간 탭', '드라이아이스 3.12 → 고압수 3.30 → 기계식 3.54 → 화학 4.27개월', pay.join(' → '),
    pay.length === 4 && pay[0].startsWith('드라이아이스 세정 3.12') && pay[1].startsWith('고압수 세정 3.3') && pay[2].startsWith('기계식 세정 3.54') && pay[3].startsWith('화학 세정 4.27'))
  const tot = await bars('총투자')
  check('공법 비교 (기본값)', '총투자 탭', '기계식 3.25억 → 고압수 4.04억 → 드라이아이스 4.46억 → 화학 7.42억 원', tot.join(' → '),
    tot.length === 4 && tot[0] === '기계식 세정 3.25억 원' && tot[1] === '고압수 세정 4.04억 원' && tot[2] === '드라이아이스 세정 4.46억 원' && tot[3] === '화학 세정 7.42억 원')

  const pinch = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('핀치·어프로치 요약')); return card ? card.innerText.replace(/\\s+/g,' ').trim() : '' })()`)
  check('B. 열역학 (기본값)', '핀치 · 어프로치 · 문구', '핀치 8.0 °C · 어프로치 5.0 °C · 「설계 범위 안입니다.」', pinch.replace(/^핀치·어프로치 요약 /, ''),
    /핀치 8 ?°C/.test(pinch) && /어프로치 5 ?°C/.test(pinch) && pinch.includes('설계 범위 안입니다.'))

  // 공법 하나의 비용을 지움 → 「산출 불가 — 입력 필요: 세정 비용」
  await p.ev(`[...document.querySelectorAll('details, button')].filter(e => e.innerText && e.innerText.trim().startsWith('고압수 세정')).forEach(e => { if (e.tagName === 'DETAILS') e.open = true; else if (e.getAttribute('aria-expanded') === 'false') e.click() })`)
  await p.wait(300)
  await p.type('#in-costHighPressureWater', '')
  await p.wait(300)
  await p.click('button', '계산 실행')
  await p.until(`!document.body.innerText.includes('계산 중') && document.body.innerText.includes('입력 필요: 세정 비용')`, 15000)
  const missing = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('세정 공법별 비교')); const cell = card.querySelector('[data-unavailable]'); const bar = [...card.querySelector('[role=img]').children].find(d => d.innerText.includes('고압수')); return (cell ? cell.innerText : '') + ' | 막대: ' + (bar ? bar.innerText.replace(/\\s+/g,' ') : '') })()`)
  check('공법 비교', '공법 하나의 비용을 지움 (고압수)', '「산출 불가 — 입력 필요: 세정 비용」', missing, missing.startsWith('산출 불가 — 입력 필요: 세정 비용'))
  // 다시 기본값
  await p.click('button', '기본값 초기화')
  await p.wait(800)

  // ───────── 체크리스트 ─────────
  await p.go(`${BASE}/checklist`, 2500)
  await p.until(`document.querySelectorAll('tbody tr').length >= 49`, 10000)
  const cards = await p.ev(`[...document.querySelectorAll('[data-kpi]')].map(v => v.closest('.card').innerText.replace(/\\s+/g,' ').trim())`)
  check('체크리스트 (처음)', '수령률', '0% 0/49', cards[0], cards[0].includes('0%') && cards[0].includes('0/49'))
  check('체크리스트 (처음)', '필수 충족', '0/16', cards[3], cards[3].includes('0/16'))
  const cat = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.startsWith('카테고리별 수령률') || c.innerText.includes('카테고리별 수령률')); return [...card.querySelectorAll('button')].map(b => b.innerText.replace(/\\s+/g,' ').trim()) })()`)
  const catStr = cat.map((t) => t.replace(/^([A-E])\. .* (\d+\/\d+)$/, '$1 $2')).join(' · ')
  check('체크리스트 (처음)', '카테고리별 수령률', 'A 0/6 · B 0/13 · C 0/9 · D 0/3 · E 0/18', catStr, catStr === 'A 0/6 · B 0/13 · C 0/9 · D 0/3 · E 0/18')
  const dist = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('수급 상태 분포')); return card.innerText.replace(/\\s+/g,' ') })()`)
  const notEntered = dist.match(/실측 미입력\s*(\d+)/)?.[1]
  const missReq = await p.ev(`(() => { const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('미수령 필수 항목')); return card ? card.querySelectorAll('p button').length : 0 })()`)
  check('체크리스트 (처음)', '실측 미입력 · 미수령 필수', '실측 미입력 49 · 미수령 필수 16개', `실측 미입력 ${notEntered ?? '(못 읽음)'} · 미수령 필수 ${missReq}개`, notEntered === '49' && missReq === 16)
  // 목록 수 = 「필수만」 옆의 n/49
  const count = () => p.ev(`[...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').nextElementSibling.innerText.trim()`)
  check('체크리스트 (처음)', '목록 수', '「49/49」', await count(), (await count()) === '49/49')
  await p.ev(`(() => { const cb = [...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').querySelector('input'); cb.click() })()`)
  await p.until(`[...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').nextElementSibling.innerText.trim() === '16/49'`, 5000)
  check('체크리스트 (처음)', '필수만', '16', await count(), (await count()) === '16/49')
  await p.ev(`(() => { const cb = [...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').querySelector('input'); cb.click() })()`)
  await p.wait(500)
  await p.type('input[placeholder^="검색 (ID"]', '핀치')
  await p.until(`[...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').nextElementSibling.innerText.trim() === '5/49'`, 5000)
  check('체크리스트 (처음)', '「핀치」 검색', '5건', await count(), (await count()) === '5/49')
  await p.type('input[placeholder^="검색 (ID"]', '')
  await p.until(`[...document.querySelectorAll('label')].find(l => l.innerText.trim() === '필수만').nextElementSibling.innerText.trim() === '49/49'`, 5000)
  const b09 = await p.ev(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find(r => r.children[1]?.innerText === 'B-09'); return tr ? tr.children[4].innerText.trim() : '' })()`)
  check('체크리스트 (처음)', 'B-09 측정값', '「문서」', b09, b09 === '문서')

  // A-01 을 수령 완료로 → 2% (1/49), 새로고침해도 유지
  await p.type('select[aria-label="A-01 수급 상태"]', 'RECEIVED')
  await p.until(`[...document.querySelectorAll('[data-kpi]')][0]?.closest('.card').innerText.includes('1/49')`, 8000)
  const after = await p.ev(`[...document.querySelectorAll('[data-kpi]')][0].closest('.card').innerText.replace(/\\s+/g,' ').trim()`)
  await p.go(`${BASE}/checklist`, 2500)
  await p.until(`document.querySelectorAll('[data-kpi]').length >= 4`, 8000)
  const reloaded = await p.ev(`[...document.querySelectorAll('[data-kpi]')][0].closest('.card').innerText.replace(/\\s+/g,' ').trim()`)
  check('체크리스트', 'A-01 을 수령 완료로 (새로고침 후)', '수령률 2% (1/49), 새로고침해도 유지', `${after} → 새로고침: ${reloaded}`,
    after.includes('2%') && after.includes('1/49') && reloaded.includes('2%') && reloaded.includes('1/49'))

  // A-02 체크 → 「요청 메일 초안 (1)」, 문구에 「- A-02 운전 배압 … [필수]」
  await p.ev(`document.querySelector('input[aria-label="A-02"]').click()`)
  await p.wait(300)
  const mailBtn = await p.ev(`[...document.querySelectorAll('button')].map(b => b.innerText.trim()).find(t => t.startsWith('요청 메일 초안'))`)
  await p.click('button', '요청 메일 초안')
  await p.wait(400)
  await p.click('button', '초안 생성')
  await p.until(`document.querySelector('#mail-body')?.value.length > 0`, 8000)
  const mailText = await p.ev(`document.querySelector('#mail-body').value`)
  const line = mailText.split('\n').find((l) => l.startsWith('- A-02')) ?? '(없음)'
  check('메일 · Excel', 'A-02 체크 → 메일 초안', '「요청 메일 초안 (1)」, 문구에 「- A-02 운전 배압 … [필수]」', `${mailBtn} / ${line}`,
    mailBtn === '요청 메일 초안 (1)' && line.startsWith('- A-02 운전 배압') && line.endsWith('[필수]') && mailText.split('\n').filter((l) => l.startsWith('- ')).length === 1)
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await p.click('button', '닫기')
  await p.wait(300)

  // 표준 양식에 A-02 측정값을 채워 가져오면 A-02 가 「검증 필요」
  const b64 = await p.ev(`fetch('/api/checklist/template/', {credentials:'same-origin'}).then(r => r.arrayBuffer()).then(b => { let s=''; const u=new Uint8Array(b); for (let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s) })`)
  const dir = mkdtempSync(join(tmpdir(), 'hrsgx-kit-'))
  const tpl = join(dir, 'template.xlsx'), reply = join(dir, 'reply.xlsx')
  writeFileSync(tpl, Buffer.from(b64, 'base64'))
  const py = spawnSync(join(BACKEND, '.venv/bin/python'), ['-I', '-c', `
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1]); ws = wb['체크리스트']
head = [c.value for c in ws[1]]
for row in ws.iter_rows(min_row=2):
    if row[0].value == 'A-02':
        row[head.index('측정값')].value = 350
wb.save(sys.argv[2])`, tpl, reply], { encoding: 'utf8' })
  if (py.status !== 0) throw new Error(py.stderr)
  readFileSync(reply)
  await p.setFile('input[type=file][accept=".xlsx"]', reply)
  await p.until(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '반영' && !b.disabled)`, 10000)
  await p.click('button', '반영')
  await p.until(`(() => { const s = document.querySelector('select[aria-label="A-02 수급 상태"]'); return s && s.value === 'NEEDS_CHECK' })()`, 10000)
  const a02 = await p.ev(`(() => { const s = document.querySelector('select[aria-label="A-02 수급 상태"]'); const tr = s.closest('tr'); return tr.children[4].innerText.trim() + ' · ' + s.options[s.selectedIndex].text })()`)
  check('메일 · Excel', '표준 양식 A-02 측정값 → 회신 가져오기', 'A-02 가 「검증 필요」', `A-02: ${a02}`, a02.endsWith('검증 필요'))
} catch (e) {
  console.error('확인 중 오류:', e.message)
  rows.push({ screen: '오류', item: e.message, expected: '', actual: '', ok: false })
} finally {
  for (const id of created) await p.api(`/cases/${id}/`, 'DELETE').catch(() => null)
  try { cleanupE2eCases(created) } catch (e) { console.error('임시 케이스 정리 실패:', e.message) }
  await p.close()
  deleteE2eAccounts()
}
const out = join(tmpdir(), 'hrsgx-kit-expected.json')
writeFileSync(out, JSON.stringify(rows, null, 2))
console.log(`\n결과: ${rows.filter((r) => r.ok).length}/${rows.length} 일치 · 기록: ${out}`)
process.exit(rows.every((r) => r.ok) ? 0 : 1)
