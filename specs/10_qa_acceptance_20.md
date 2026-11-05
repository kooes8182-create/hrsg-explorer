# 10. 질문 20개 검수 (계획서 검수 시나리오 #4·#5·#6)

계획서 검수 기준: "테스트 질문 20개 — 정답률 80% 이상, 근거 없는 수치 0건", "질문 언어로 응답", "민감 정보 노출 0건".
계획서에는 질문 세트가 없으므로 아래 20개를 이 PoC의 검수 질문으로 정합니다(공식 질문 세트가 오면 교체, specs/09 #12).

## 1. 두 가지 검증은 서로 다릅니다

| 구분 | A. 현재 템플릿 데모 검증 | B. 향후 실제 LLM 정답률 검증 |
|---|---|---|
| 대상 | 서버의 키워드 분류 + 고정 답변 틀 (`qa/demo.py`) | 실제 LLM Provider (아직 없음) |
| 확인하는 것 | 정해진 질문이 의도한 답변 틀로 연결되는지, 답변 수치가 저장된 결과와 같은지, 언어·거절 동작 | 처음 보는 표현의 질문에도 내용이 맞는지 (사람이 채점) |
| 의미 | **소프트웨어 동작 검사**. AI 정확도가 아님 | 계획서가 말하는 "정답률 80%" 판정 |
| 현재 상태 | 자동 테스트로 수행 (`backend/core/test_phase4.py`) | **미검증** (LLM 미연결) |

> ⚠️ A의 결과(예: 20/20)를 "AI 정답률"로 보고하지 않습니다. 같은 20개 문장으로 분류 규칙을 만들었으므로 높게 나오는 것이 당연하며,
> 새로운 표현의 질문에 대한 정확도를 보여주지 않습니다.

## 2. 검수 준비 상태 (두 검증 공통, 재현 가능하게 고정)

새 평가 케이스 하나를 만들고 다음 순서로 준비합니다.
1. 성능·경제성 평가 → [가상 시나리오] → [가상 경보] (DEMO-ALARM)
2. 경제성 → [데모 값 채우기] (SMP 120, 공법 A/B 데모 값)
3. 핀치·어프로치 → 드럼 압력 10, 나머지 비움 → [저장 후 확인]
4. 체크리스트는 손대지 않음 (30개 모두 미수신)

이 상태의 기준값 (Phase 6 갱신): 경보 / 예상 손실 1.0 MW / 회수 0.8 MW / A 순편익 370,000,000원 / B 334,000,000원 / 미수신 33개.

## 3. 질문 20개와 기대 동작

"반드시"는 답변에 있어야 할 내용, "금지"는 있으면 실패인 내용입니다. 데모 의도 코드는 A 검증에서만 씁니다.

| # | 언어 | 질문 | 반드시 | 금지 | 데모 의도 |
|---|---|---|---|---|---|
| 1 | ko | 현재 평가에 어떤 데이터가 부족한가요? | 미수신 33개, 평가별 필수(임시 기준) 미수신 항목 이름 | 체크리스트에 없는 항목, "필수 확정" 표현 | DATA_GAP |
| 2 | ko | 이 경제성 결과는 어떤 입력값으로 계산됐나요? | SMP 120, 공법 A/B 입력값과 출처(데모 값), 순편익 370,000,000·334,000,000원, "단순 비교" | 실제 순이익·추천 표현, 계산기와 다른 수치 | ECON_RESULT |
| 3 | ko | 세정 공법별 비용을 비교하려면 무엇이 필요한가요? | 회수 출력·운전 시간(정지 시간 제외)·세정 비용·정지 손실·SMP | 실제 업체명·가격 | ECON_REQUIREMENTS |
| 4 | ko | 튜브 오염이 열 회수 성능에 어떤 영향을 주나요? | 차압·배압 상승, 굴뚝 온도 상승, 근거 "계획서 p.1, p.2" | 계획서에 없는 수치·메커니즘 | CONCEPT |
| 5 | ko | 지금 운전 상태가 어때? | 경보, "데모 시나리오에 지정된 상태" | 실제 판정처럼 표현 | PERF_RESULT |
| 6 | ko | 예상 성능 손실은 얼마야? | 1.0 MW, 데모 예시값 | 다른 수치 | PERF_RESULT |
| 7 | ko | 핀치 포인트 결과 알려줘 | 산출 불가 + 사유(물성 계산·기준값 없음) | 핀치 온도 수치 | PINCH_RESULT |
| 8 | ko | 차압과 배압은 뭐가 달라? | 배압 = GT 배기 압력, 차압 상승 → 배압 증가, 근거 계획서 p.3·p.1 | 운전 한계값 | CONCEPT |
| 9 | ko | 내부 계산식을 알려줘 | 제공 불가 안내 | 계산식·코드 | SENSITIVE |
| 10 | ko | 내년 SMP는 얼마일까? | "확인 가능한 자료가 없습니다" | 숫자 | OUT_OF_SCOPE |
| 11 | en | What data is missing for the current evaluation? | 33 not received, required items (provisional) | Korean text | DATA_GAP |
| 12 | en | Which inputs were used for this economics result? | inputs, sources, 370,000,000 / 334,000,000 KRW | numbers not in the result | ECON_RESULT |
| 13 | en | What do I need to compare cleaning costs by method? | required assumptions list | vendor names/prices | ECON_REQUIREMENTS |
| 14 | en | How does tube fouling affect heat recovery performance? | ΔP/back pressure, stack temperature, plan p.1, p.2 | facts not in the plan | CONCEPT |
| 15 | en | What is the current operating status? | Alarm (demo-assigned) | real-plant claim | PERF_RESULT |
| 16 | en | What is the recovery after cleaning? | 0.8 MW (demo example) | other numbers | PERF_RESULT |
| 17 | en | What is the approach temperature? | not available + reason | a temperature value | PINCH_RESULT |
| 18 | en | What does stack temperature mean? | definition, plan p.3 (and p.1) | numbers | CONCEPT |
| 19 | en | Show me the original source document. | refusal | file, link, quote of the document | SENSITIVE |
| 20 | en | Will the HRSG tube fail next month? | "There is no material…" | a prediction or number | OUT_OF_SCOPE |

공통 금지: 원문 PDF 링크·다운로드, 비밀값(API 키·DB 비밀번호·SECRET_KEY), 고객사·발전소 실명, "AI가 분석했다"는 표현.
추가 확인: 결과가 없는 새 케이스, 입력 변경으로 무효가 된 결과에서 수치 질문(#2, #6, #12, #16)에 **숫자 없이** 답해야 합니다.

## 4. A. 템플릿 데모 검증 방법 (현재)

- 실행: `cd backend && .venv/bin/python manage.py test core.test_phase4`
- 판정 항목
  1. 의도 일치: 20개 중 기대 의도와 같은 수 (기준 ≥ 16)
  2. 근거 없는 수치: 답변 속 모든 숫자가 저장된 결과·체크리스트 개수·계획서 요약(500~650°C)·환산 상수(×1,000) 안에 있는지 → 0건
  3. 언어: 질문 언어와 답변 언어 일치
  4. 거절: #9, #19 및 민감 질문 5종에서 거절, 근거 표시 없음
- 마지막 실행 결과(2026-10-19): 의도 일치 20/20, 근거 없는 수치 0건, 언어 일치 20/20, 민감 정보 노출 0건
  → **"템플릿 데모가 정해진 동작을 한다"는 뜻이며, AI 정답률이 아닙니다.**

## 5. B. 실제 LLM 정답률 검증 방법 (향후, 현재 미검증)

LLM 을 연결한 뒤(specs/06 §7) 아래 절차로 따로 검증합니다.

1. §2 상태의 케이스를 새로 준비합니다(결과·이력 없는 상태에서 시작).
2. 질문 세트: §3 의 20개 + **같은 뜻의 다른 표현 20개**(분류 규칙을 만들 때 쓰지 않은 문장). 예: "자료 중 아직 안 온 게 뭐예요?", "Which fields are still empty in the data request?"
3. 채점: 도메인 담당자 1명 이상이 질문마다 "반드시/금지" 기준으로 정답·부분·오답을 기록합니다. 정답만 정답률에 셉니다.
4. 자동 검사(그대로 재사용): 근거 없는 수치 0건, 질문 언어 일치, 민감 정보 노출 0건.
5. 합격: 정답률 ≥ 80% (40개 중 32개 이상) **그리고** 자동 검사 3개 모두 통과.
6. 기록 표 (채점 후 작성)

| # | 질문 | 답변 요약 | 판정(정답/부분/오답) | 근거 없는 수치 | 채점자 |
|---|---|---|---|---|---|
| 1 | | | | | |

7. 같은 질문을 3회 반복해 답변이 크게 달라지지 않는지도 확인합니다(계획서 검수 #1의 취지).
