import type { Bilingual } from '../api/types'
import type { IconName } from '../components/Icon'

// 사이드바 메뉴 = 화면 목록. key 는 i18n 의 page.<key> 와 같습니다.
// phase: 실제 기능을 구현하는 Phase. planned: 그 Phase 에서 만들 기능 (아직 없는 화면에 정직하게 표시).
export interface PageDef {
  key: string
  path: string
  icon: IconName
  phase: number
  planned?: Bilingual[]
}

export interface MenuGroup {
  key: 'overview' | 'engineering' | 'ai' | 'system' | 'rag'
  pages: PageDef[]
}

const b = (ko: string, en: string): Bilingual => ({ ko, en })

export const MENU: MenuGroup[] = [
  {
    key: 'overview',
    pages: [
      {
        key: 'dashboard', path: '/dashboard', icon: 'dashboard', phase: 4,
        planned: [
          b('KPI 7개 (배압, 스택 온도, 출력 손실, 월간 손실액, 회수 효과, 세정 필요도, 데이터 수령률)', '7 KPIs (back pressure, stack temp, output loss, monthly loss, recovery, cleaning need, data readiness)'),
          b('운전 상태 패널과 HRSG 공정 흐름도', 'Operating status panel and HRSG process diagram'),
          b('성능 추이, 세정 전후 요약, 데이터 준비도', 'Performance trend, before/after summary, data readiness'),
          b('작업 진행 현황, 최근 활동, 다음 작업 추천, AI 빠른 질문', 'Workflow progress, recent activity, next-step suggestions, quick AI questions'),
        ],
      },
    ],
  },
  {
    key: 'engineering',
    pages: [
      {
        key: 'checklist', path: '/checklist', icon: 'checklist', phase: 3,
        planned: [
          b('통합 체크리스트 (프롬프트 22개 + 기존 33개 항목, 중복 통합 → 40개)', 'Unified checklist (22 prompt + 33 existing items, deduplicated → 40)'),
          b('수급 상태·검증 상태 분리, 측정값 없으면 검증 완료 불가', 'Separate supply/verification status; no verification without a value'),
          b('검색·필터·일괄 처리, 요청 이메일 초안', 'Search, filters, bulk actions, request e-mail draft'),
        ],
      },
      {
        key: 'simulation', path: '/simulation', icon: 'simulation', phase: 3,
        planned: [
          b('DEMO / 사용자 입력 모드, Normal·Alarm·Trip·Custom 시나리오', 'DEMO / user mode; Normal, Alarm, Trip, Custom scenarios'),
          b('입력 검증, 평가 실행, 재평가 필요 표시, 시나리오 값 복원', 'Validation, run, re-evaluation flag, restore preset'),
        ],
      },
      {
        key: 'calculator', path: '/calculator', icon: 'calculator', phase: 3,
        planned: [
          b('서버 계산 엔진: 초과 배압, 출력 손실, 손실액, 정지 손실, 회수기간, BEP (DEMO 계수 표시)', 'Server engine: excess BP, output loss, loss cost, outage cost, payback, BEP (DEMO coefficients shown)'),
          b('세정 필요도 지수, 핀치·어프로치(IAPWS-IF97), 공법 3종 비교', 'Cleaning need index, pinch/approach (IAPWS-IF97), 3 cleaning methods'),
          b('단계별 계산식, 스냅샷 저장·비교, 민감도 분석', 'Step-by-step formulas, snapshots, sensitivity analysis'),
        ],
      },
      {
        key: 'analysis', path: '/analysis', icon: 'analysis', phase: 3,
        planned: [
          b('세정 효과 추정 (GE GER-3567H, IST 2000 참고 범위)', 'Cleaning effect estimate (GE GER-3567H, IST 2000 reference ranges)'),
          b('경제성 비교 + KPX/EPSIS SMP 실적', 'Economics comparison + KPX/EPSIS SMP history'),
          b('Pinch / Approach 분석, 분석 근거(문헌·공식·한계)', 'Pinch/approach analysis, basis (literature, formulas, limits)'),
        ],
      },
      {
        key: 'beforeAfter', path: '/before-after', icon: 'beforeAfter', phase: 3,
        planned: [
          b('세정 전후 실측값 입력 (경과일 음수 허용)', 'Before/after measurements (negative day offsets allowed)'),
          b('운전 조건 편차 경고 (부하 5%p, 외기 5 °C — DEMO 가드레일)', 'Condition deviation warning (load 5 pp, ambient 5 °C — DEMO guardrail)'),
          b('누적 순편익과 손익분기점', 'Cumulative net benefit and break-even'),
        ],
      },
    ],
  },
  {
    key: 'ai',
    pages: [
      {
        key: 'aiAssistant', path: '/ai-assistant', icon: 'ai', phase: 5,
        planned: [
          b('대화 목록·채팅·근거 패널 3열 화면', 'Three-column chat with conversation list and evidence panel'),
          b('공식 확정 설정 검색 (BM25 + BGE-M3 가중 RRF, recall 재현 검증)', 'Locked official retrieval (BM25 + BGE-M3 weighted RRF, recall reproduction check)'),
          b('Claude 답변 (근거 문단 8개만 전송), 계산 스냅샷 연동', 'Claude answers (only 8 evidence passages sent), calculation snapshot link'),
        ],
      },
      {
        key: 'knowledgeBase', path: '/knowledge-base', icon: 'knowledge', phase: 5,
        planned: [
          b('문헌 목록·청크 확인·인덱스 현황 (실제 DB 수치)', 'Paper list, chunks, index status (real DB counts)'),
          b('PDF 업로드 → 추출 → 청킹 → 임베딩 (공식 corpus 와 분리)', 'PDF upload → extract → chunk → embed (kept apart from the official corpus)'),
        ],
      },
      {
        key: 'ragEvaluation', path: '/rag-evaluation', icon: 'evaluation', phase: 5,
        planned: [
          b('공식 평가셋 v1 실험 기록 (dev / test 구분)', 'Official eval set v1 records (dev / test separated)'),
          b('BM25 / Dense / Hybrid 질문별 비교, 40/40 실험 설정 재현', 'Per-question BM25 / Dense / Hybrid comparison, 40/40 experiment setting'),
        ],
      },
      {
        key: 'reference', path: '/reference', icon: 'reference', phase: 3,
        planned: [
          b('용어집 (HRSG, Back Pressure, Pinch Point 등 12개)', 'Glossary (12 terms incl. HRSG, back pressure, pinch point)'),
          b('참고 문헌 (원문 확인한 공개 자료만), 자료 분류와 적용 한계', 'References (verified public sources only), classification and limits'),
        ],
      },
    ],
  },
  {
    key: 'system',
    pages: [{ key: 'settings', path: '/settings', icon: 'settings', phase: 2 }],
  },
]

export const PAGES = MENU.flatMap((g) => g.pages)

// 기존 HRSG 앱 주소 → 새 주소 (해시 주소 #/data 도 같은 규칙으로 처리)
export const LEGACY_REDIRECTS: [string, string][] = [
  ['/home', '/dashboard'],
  ['/overview', '/dashboard'],
  ['/data', '/checklist'],
  ['/simulate', '/simulation'],
  ['/evaluate', '/simulation'],
  // 예전 분석 탭 주소 → 새 탭 (?tab=)
  ['/analysis/reference', '/analysis?tab=reference'],
  ['/analysis/economics', '/analysis?tab=economics'],
  ['/analysis/pinch', '/analysis?tab=pinch'],
  ['/analysis/sources', '/analysis?tab=basis'],
  ['/ask', '/ai-assistant'],
  ['/lab', '/rag-evaluation'],
  ['/dev/search', '/rag-evaluation'],
]
