# 06. AI 질문하기

(Phase 4 구현 기준으로 갱신)

## 1. 현재 범위
- **LLM API 키와 승인된 내부 지식 자료가 없으므로 실제 LLM을 호출하지 않습니다.**
- 서버의 **템플릿 기반 데모 답변**만 제공합니다. 모든 답변에 `데모 답변` 배지를 붙이고,
  화면 상단에 "데모 답변 — 실제 AI(LLM)는 연결되어 있지 않습니다." 를 항상 표시합니다.
- 실제 AI가 연결된 것처럼 표현하지 않습니다(예: "AI가 분석했습니다" 금지). `GET /api/qa/info/` 의 `llm_connected` 는 항상 `false`.

## 2. 모듈 구조 (답변 생성 인터페이스와 서비스 분리)

```
backend/qa/
├── base.py      # AnswerProvider 인터페이스, AnswerContext·Answer 자료형
├── intents.py   # 언어 감지, 한/영 키워드 기반 의도 분류
├── sources.py   # 일반 설명 = HRSG 계획서에서 확인한 범위의 요약 + 자료명·페이지
├── demo.py      # TemplateDemoProvider (의도별 한/영 답변 틀)
└── service.py   # build_context() → get_provider().answer() → QuestionLog 저장. 추천 질문 목록
```

```python
@dataclass
class AnswerContext:            # Provider 가 쓸 수 있는 근거 전부
    case_id: int; case_name: str; lang: str          # lang = 질문 언어
    checklist: dict             # 진행률 + 평가 기능별 미수신 필수 항목(임시 기준)
    economics_inputs: dict      # 현재 저장된 경제성 가정값 (빈 칸 안내용)
    results: dict               # kind -> {result, meta, stale} | None

@dataclass
class Answer:
    text: str; intent: str; answer_type: str          # "DEMO_TEMPLATE" (향후 "LLM")
    citations: list             # checklist / result / document(자료명·페이지) / app_rule
    cards: list                 # 저장된(무효 아닌) 결과 수치만

class AnswerProvider:
    answer_type: str
    def answer(self, question: str, ctx: AnswerContext) -> Answer: ...
```

## 3. 근거 범위
| 답변 내용 | 가져오는 곳 |
|---|---|
| 수신 현황, 부족한 데이터 | 케이스의 체크리스트 (저장 상태) |
| 수치, 계산 조건, 출처(사용자 가정/데모 값) | 저장된 계산 결과 `CalculationResult` (`stale=false` 인 것만) |
| 일반 설명 | `qa/sources.py` — **HRSG 레퍼런스 앱 계획서** 요약. 답변 근거에 자료명·페이지·절을 표시 |

계획서 요약 주제와 페이지:

| 주제 | 페이지 |
|---|---|
| HRSG 정의 (배기가스 500~650°C 폐열로 증기 생산) | p.1 (계획서가 밝힌 원출처: Week 2 세미나 자료) |
| 가스측 오염의 영향 (유동 저항→차압·배압, 열전달 저항→굴뚝 온도) | p.1, p.2(프로젝트 목표) |
| 배압·차압 | p.3(용어), p.1 |
| 굴뚝 온도 | p.3(용어), p.1 |
| 핀치·어프로치 포인트 정의 | p.3(용어) |
| SMP 정의, KPX 공공 데이터 | p.3(용어, 4. 데이터) |

- 원문 PDF는 웹으로 제공하지 않습니다. 답변·화면에 링크나 다운로드 버튼이 없습니다.
- 협력사 기술 자료·사례는 제공되지 않았으므로 근거로 쓰지 않습니다.

## 4. 의도 분류 (우선순위 순)

| 의도 | 예시 (ko / en) | 답변 |
|---|---|---|
| `SENSITIVE` | 계산식, 원문, PDF, 다운로드, 고객사, API 키 / formula, source document, customer | 제공 불가 안내 (근거 없음) |
| `OUT_OF_SCOPE` | 내년, 전망, 예측, 고장 / next year, forecast, will … fail | "확인 가능한 자료가 없습니다" |
| `ECON_REQUIREMENTS` | 공법별 비용을 비교하려면 무엇이 필요 / what do I need to compare | 필요한 가정값 목록 + 현재 빈 칸 (수치 없음) |
| `ECON_RESULT` | 경제성 결과, 순편익, 매출 / economics result, net benefit | 저장된 경제성 결과의 입력 조건·출처·결과 + 계산 방법 + 안내문 |
| `DATA_GAP` | 부족, 미수신 / missing, not received | 체크리스트 수신 현황 + 평가 기능별 미수신 필수 항목(최대 10개 이름) |
| `PINCH_RESULT` | 핀치 결과, 어프로치 온도 / pinch result, approach temperature | 산출 불가 사유 + 계획서 정의 |
| `CONCEPT` (오염) | 튜브 오염, 열 회수 / fouling, heat recovery | 계획서 p.1·p.2 요약 |
| `PERF_RESULT` | 운전 상태, 손실, 회복 / status, loss, recovery | 저장된 성능 결과 (데모면 "시연용" 안내, 실제면 모델 미연동) |
| `CONCEPT` | 차압, 배압, 굴뚝, 핀치란, SMP, HRSG란 | 계획서 요약 (자료명·페이지) |
| `UNKNOWN` | 그 외 | "확인 가능한 자료가 없습니다" + 처리 가능한 범위 안내 |

- 언어: 질문에 한글이 있으면 `ko`, 없으면 `en`. **질문 언어로 답합니다**(UI 언어와 무관).

## 5. 답변 규칙
1. 수치는 저장된 계산 결과와 체크리스트 개수에서만 가져옵니다. 답변 틀에 수치를 직접 쓰지 않습니다
   (예외: 계획서 요약의 "500~650°C", 경제성 계산 방법 설명의 MW→kW 환산 "×1,000").
2. 결과가 없거나 `null` 이면 수치를 만들지 않고 사유를 전합니다.
3. `stale`(입력 변경으로 무효) 결과는 **수치를 인용하지 않고** "무효(재평가 필요)" 라고 안내합니다.
4. 범위 밖 질문에는 설명이나 수치를 만들지 않고 "확인 가능한 자료가 없습니다" 로 답합니다.
5. 근거(체크리스트 / 계산 결과의 종류·근거 종류·버전·계산 시점 / 계획서 자료명·페이지)를 답변 아래에 표시합니다.
6. 세정 여부·공법을 "결정"하거나 "추천"하지 않습니다 ("가정 기준 순편익 최대"는 추천이 아님을 명시).

## 6. 화면
- 상단 데모 안내, 추천 질문 4개(UI 언어에 따라 한국어/영어), 케이스별 이력(새로고침 후 복원).
- 질문 입력: Enter 보내기 / Shift+Enter 줄바꿈 (한글 조합 중 Enter 는 보내지 않음), 최대 500자.
- 답변 생성 중 표시, 실패 시 오류 안내 + 입력한 질문 유지 + [다시 보내기].
- 답변의 결과 수치는 결과 카드(값·단위·근거 배지)로도 표시합니다.
- 성능·경제성·핀치 결과 카드의 [이 결과 질문하기] → 질문 화면으로 이동하며 해당 질문을 채움(보내기는 사용자가).

추천 질문:

| ko | en |
|---|---|
| 현재 평가에 어떤 데이터가 부족한가요? | What data is missing for the current evaluation? |
| 이 경제성 결과는 어떤 입력값으로 계산됐나요? | Which inputs were used for this economics result? |
| 세정 공법별 비용을 비교하려면 무엇이 필요한가요? | What do I need to compare cleaning costs by method? |
| 튜브 오염이 열 회수 성능에 어떤 영향을 주나요? | How does tube fouling affect heat recovery performance? |

## 7. 실제 LLM 연결 방법 (아직 연결하지 않음)

**연결 위치**: `backend/qa/service.py` 의 `get_provider()`. 현재는 환경변수와 관계없이 항상 `TemplateDemoProvider` 를 반환합니다.

**필요한 환경변수** (`backend/.env`, 값은 커밋 금지 — `.env.example` 에는 빈 자리만 있음)

| 변수 | 용도 | 현재 |
|---|---|---|
| `QA_PROVIDER` | `demo` / `llm` 선택 | 읽지 않음 (항상 demo) |
| `LLM_API_KEY` | LLM API 키 | 비어 있음 |
| `LLM_MODEL` | 사용할 모델 이름 | 비어 있음 |

**연결 절차**
1. `backend/qa/llm.py` 에 `LLMProvider(AnswerProvider)` 를 만들고 `answer_type = "LLM"` 으로 둡니다.
2. 프롬프트에는 `AnswerContext` 와 `qa/sources.py` 요약만 넣습니다. 원문 PDF, 비공개 계산식, 비밀값, 고객사 정보는 넣지 않습니다.
3. 응답 검증: 답변 속 수치가 `ctx.results`·체크리스트에 있는 값인지 확인하고, 아니면 데모 답변으로 대체하거나 "확인할 수 없음"으로 바꿉니다
   (`core/test_phase4.py` 의 근거 없는 수치 검사를 그대로 재사용).
4. `get_provider()` 에서 `QA_PROVIDER == "llm"` 이고 `LLM_API_KEY` 가 있을 때만 `LLMProvider` 를 반환합니다. 실패 시 데모 Provider 로 돌아가고 화면에 그 사실을 표시합니다.
5. `provider_status()` 의 `llm_connected` 를 실제 연결 여부로 바꾸고, 화면 안내 문구와 배지를 `LLM 답변` 으로 구분합니다.
6. 키 오류·네트워크 오류 시 앱이 멈추지 않고 안내하는지(검수 #7) 확인합니다.
