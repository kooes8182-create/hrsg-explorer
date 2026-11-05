// 발표 모드: 화면에 보이는 'DEMO'·'가상' 표시를 숨기고, 맨 아래 한 줄('시연용 시나리오 데이터')만 남깁니다.
// - 화면에 그려진 글자만 바꿉니다 (서버 데이터·계산·저장값은 그대로). 끄면 페이지를 새로 불러와 원래 표시로 돌아갑니다.
// - DEMO 배지(ReliabilityBadge)는 data-demo 표시로 CSS 에서 숨기고, 'DEMO' 한 단어짜리 작은 칩은 숨김, 버튼 글자는 '시나리오'로.

const NOTICE_KO = '시연용 시나리오 데이터'
const NOTICE_EN = 'Scenario data for demonstration'

// 순서대로 적용 (긴 문구 먼저)
const RULES: [RegExp, string][] = [
  [/가상 데이터 데모 — 실제 설비 운전·안전 판단에 사용하지 마세요\.?/g, NOTICE_KO],
  [/Virtual-data demo — (do not use|not) for real plant operation or safety decisions\.?/g, NOTICE_EN],
  [/\s*\(가상 — 실제 설비 경보 아님\)/g, ''],
  [/\s*가상 운전 상태 \(실측 아님\)/g, ''],
  [/\s*\((가상|virtual|DEMO|실측 아님)\)/gi, ''],
  [/\s*[—-] 실제 설비 경보가? 아닙?니?다?\.?/g, ''],
  [/\s*(이며\s*)?실제 설비 경보가 아닙니다\.?/g, '.'],
  [/\s*\(?실제 설비 경보 아님\)?/g, ''],
  [/\s*\(?실제 설비 아님\)?/g, ''],
  [/\s*·?\s*DEMO 값 \(실제 설비 아님\)/g, ''],
  [/가상 (정상|경보|트립)/g, '$1'],
  [/Virtual (normal|alarm|trip)/g, '$1'],
  [/\s*시나리오 값과 상태는 시연용 가상 값입니다[^]*$/g, ''],
  [/\s*가상 값은 실측으로 표시하지 않습니다\.?/g, ''],
  [/가상 케이스/g, '평가 케이스'],
  [/가상 시나리오/g, '시나리오'],
  [/시연용 가상 값/g, '시연용 값'],
  [/\bvirtual scenario/gi, 'scenario'],
  [/\[DEMO\]\s*/g, ''],
  [/DEMO 계산 엔진/g, '계산 엔진'],
  [/DEMO (계수|가정|휴리스틱|공식|가드레일|시나리오|값|계산값|계산)/g, '$1'],
  [/\bDEMO (engine|coefficient|assumption|heuristic|values?|scenario|formula|guardrail)/gi, '$1'],
  [/\bDEMO\b(?!-)\s*/g, ''],
  [/가상\s?/g, ''],
]

const TRIGGER = /DEMO|가상|Virtual|실측 아님|실제 설비/

function fix(text: string) {
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to as string)
  return out.replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ')
}

function rewrite(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE) return
  const v = node.nodeValue ?? ''
  if (!TRIGGER.test(v)) return
  const parent = node.parentElement
  if (!parent || parent.closest('[data-present-keep], textarea, input, script, style')) return
  // 'DEMO' 한 단어만 있는 요소: 버튼이면 '시나리오'로, 작은 칩이면 숨김
  if (v.trim() === 'DEMO') {
    if (parent.closest('button')) node.nodeValue = document.documentElement.lang === 'en' ? 'Scenario' : '시나리오'
    else parent.style.display = 'none'
    return
  }
  const next = fix(v)
  if (next !== v) node.nodeValue = next
}

function walk(root: Node) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = it.nextNode(); n; n = it.nextNode()) rewrite(n)
}

let observer: MutationObserver | null = null

/** 발표 모드가 켜져 있으면 화면 글자를 정리하기 시작 (앱 시작 시 한 번) */
export function startPresentation(on: boolean) {
  document.documentElement.classList.toggle('present', on)
  if (!on || observer) return
  const run = () => {
    walk(document.body)
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') rewrite(m.target)
        else m.addedNodes.forEach((n) => (n.nodeType === Node.TEXT_NODE ? rewrite(n) : walk(n)))
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.body) run()
  else document.addEventListener('DOMContentLoaded', run, { once: true })
}
