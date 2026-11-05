// 데이터 요청 체크리스트 로직 — 두 팀 공통 (common-0.2). 화면과 무관한 순수 함수. 항목은 data/checklist.json.
// 진행 상태(progress): { [항목 ID]: { supply, verify, reviewed, value, note } } — 항목 데이터 파일과 따로 저장한다.
//   supply : 'not_entered'(실측 미입력·대기, 기본) | 'requested'(요청 필요·요청함) | 'received'(수령 완료) | 'verify_needed'(검증 필요) | 'na'(해당 없음)
//   verify : 'unverified'(미검증, 기본) | 'in_progress'(검증 진행 중) | 'verified'(검증 완료) | 'failed'(검증 실패)
//   reviewed: 검토 체크, value: 측정값, note: 메모
// 화면 글자는 팀마다 달라도 되지만, 저장하는 값은 위의 영문 키다.

export const supplyOf = (prog, id) => prog?.[id]?.supply || 'not_entered';
export const verifyOf = (prog, id) => prog?.[id]?.verify || 'unverified';
export const isNA = (prog, id) => supplyOf(prog, id) === 'na';
// 「수령」= 데이터가 들어온 상태: 수령 완료 + 검증 필요 (임시 기준)
export const isReceived = (prog, id) => ['received', 'verify_needed'].includes(supplyOf(prog, id));
// 「필수 충족」= 수령했고 검증 실패가 아닌 상태 (임시 기준)
export const isSatisfied = (prog, id) => isReceived(prog, id) && verifyOf(prog, id) !== 'failed';

// 비율: 해당 없음은 분모에서 뺀다. 「0% (0/49)」
const rate = (items, prog, ok) => {
  const counted = items.filter(i => !isNA(prog, i.id)), done = counted.filter(i => ok(i)).length;
  return { done, total: counted.length, percent: counted.length ? Math.round(done / counted.length * 100) : 0 };
};

// 진행 상태 검사: 모르는 항목 ID, 모르는 상태 값(화면 글자를 그대로 넣은 경우 포함), 모르는 필드
const PROGRESS_KEYS = ['supply', 'verify', 'reviewed', 'value', 'note'];
export function validateProgress(C, prog) {
  const errors = [], warnings = [], ids = new Set(C.items.map(i => i.id));
  for (const [id, p] of Object.entries(prog ?? {})) {
    if (!ids.has(id)) { errors.push(`항목 ID ${id} 는 체크리스트에 없습니다 (A-01 ~ E-18 형식).`); continue; }
    for (const [k, states] of [['supply', C.supply_states], ['verify', C.verify_states]]) {
      const v = p?.[k];
      if (v === undefined || v in states) continue;
      const key = Object.keys(states).find(s => states[s] === v);
      errors.push(`${id}.${k} 값 ${JSON.stringify(v)} 를 모릅니다. ${key ? `화면 글자 대신 "${key}" 를 넣어 주세요.` : `가능한 값: ${Object.keys(states).join(', ')}`}`);
    }
    for (const k of Object.keys(p ?? {})) if (!PROGRESS_KEYS.includes(k)) warnings.push(`${id}.${k} 는 키트가 쓰지 않는 이름입니다.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// 상단 카드: 전체 수령률 · 검토 진행률 · 검증 완료율 · 필수 충족률
export function kpis(C, prog) {
  return {
    received: rate(C.items, prog, i => isReceived(prog, i.id)),
    reviewed: rate(C.items, prog, i => !!prog?.[i.id]?.reviewed),
    verified: rate(C.items, prog, i => verifyOf(prog, i.id) === 'verified'),
    required: rate(C.items.filter(i => i.required), prog, i => isSatisfied(prog, i.id)),
  };
}

// 카테고리별 수령률: 「A. 가스터빈/운전 0/6」
export const byCategory = (C, prog) =>
  C.categories.map(c => ({ id: c.id, name: c.name, ...rate(C.items.filter(i => i.category === c.id), prog, i => isReceived(prog, i.id)) }));

// 한 번에: 「전체 진행률 0% (0/49)」「필수 0/16」 + 카테고리별
export const summary = (C, prog) => ({ all: kpis(C, prog).received, required: kpis(C, prog).required, byCategory: byCategory(C, prog) });

// 수급 상태 분포(도넛), 검증 상태, 미수령 필수 항목 ID
export function distribution(C, prog) {
  const count = (states, of) => Object.fromEntries(Object.keys(states).map(s => [s, C.items.filter(i => of(prog, i.id) === s).length]));
  return {
    total: C.items.length,
    supply: count(C.supply_states, supplyOf),
    verify: count(C.verify_states, verifyOf),
    missing_required: C.items.filter(i => i.required && !isReceived(prog, i.id) && !isNA(prog, i.id)).map(i => i.id),
  };
}

// 범주 × 수급 상태 표 (칸을 누르면 filterItems({ category, supply }))
export const matrix = (C, prog) =>
  C.categories.map(c => ({ id: c.id, name: c.name,
    counts: Object.fromEntries(Object.keys(C.supply_states).map(s => [s, C.items.filter(i => i.category === c.id && supplyOf(prog, i.id) === s).length])) }));

// 목록 필터: 검색(ID·항목명·이유), 카테고리, 수급 상태, 필수만, 미완료만(수령·해당 없음 제외)
export function filterItems(C, prog, { query = '', category = 'all', supply = 'all', requiredOnly = false, incompleteOnly = false } = {}) {
  const q = query.trim().toLowerCase();
  return C.items.filter(i => (!q || `${i.id} ${i.name} ${i.reason}`.toLowerCase().includes(q))
    && (category === 'all' || i.category === category)
    && (supply === 'all' || supplyOf(prog, i.id) === supply)
    && (!requiredOnly || i.required)
    && (!incompleteOnly || !(isReceived(prog, i.id) || isNA(prog, i.id))));
}

// 배지 글자. style 'level'(필수 + 높음/중간/낮음) 또는 'simple'(필수/권장/선택)
export function priorityLabel(C, i, style = 'level') {
  if (style === 'simple') return i.required ? '필수' : i.priority === 'low' ? '선택' : '권장';
  return `${i.required ? '필수 · ' : ''}${C.priorities[i.priority]}`;
}
// 항목 아래 작은 줄: "초과 배압과 출력 손실 계산 · 단위 mmH₂O 또는 mbar"
export const detailLine = i => [i.reason, i.unit && `단위 ${i.unit}`].filter(Boolean).join(' · ');
// 「측정값」 칸: 값이 있으면 값, 문서 항목은 「문서」, 나머지는 「—」
export const measureCell = (i, prog) => prog?.[i.id]?.value ?? (i.kind === 'document' ? '문서' : '—');

// 요청 메일 문구. ids 를 주면 그 항목만(「요청 메일 초안 (n)」), 안 주면 아직 받지 않은 항목 전부(「이메일 텍스트 복사」).
// 메일을 보내지 않고 문구만 만든다(복사용).
export function emailDraft(C, prog, { ids = null, plant = '', due = '' } = {}) {
  const pick = C.items.filter(i => (ids ? ids.includes(i.id) : !(isReceived(prog, i.id) || isNA(prog, i.id))));
  const lines = [`${plant ? plant + ' ' : ''}HRSG 성능 진단을 위해 아래 데이터를 요청드립니다.${due ? ` 가능하시면 ${due}까지 회신 부탁드립니다.` : ''}`, ''];
  for (const c of C.categories) {
    const rows = pick.filter(i => i.category === c.id);
    if (!rows.length) continue;
    lines.push(`[${c.name}]`);
    for (const i of rows) lines.push(`- ${i.id} ${i.name}${i.unit ? ` (${i.unit})` : ''} — ${i.reason}${i.required ? ' [필수]' : ''}`);
    lines.push('');
  }
  lines.push('필수 항목을 먼저 보내 주시면 진단을 시작할 수 있습니다. 감사합니다.');
  return lines.join('\n');
}

// 「Excel 내보내기」·「표준 양식」용 행 (CSV/XLSX 변환은 각자 라이브러리로). 표준 양식은 상태·값 칸을 비운다.
export const HEADERS = ['ID', '카테고리', '항목', '단위', '이유', '필수', '우선순위', '측정값', '수급 상태', '검증 상태', '검토', '메모'];
export function exportRows(C, prog, { template = false } = {}) {
  const cat = Object.fromEntries(C.categories.map(c => [c.id, c.name]));
  return C.items.map(i => {
    const p = template ? {} : (prog?.[i.id] ?? {});
    return [i.id, cat[i.category], i.name, i.unit, i.reason, i.required ? '필수' : '', C.priorities[i.priority], p.value ?? '',
      template ? '' : C.supply_states[supplyOf(prog, i.id)], template ? '' : C.verify_states[verifyOf(prog, i.id)], p.reviewed ? 'Y' : '', p.note ?? ''];
  });
}

// 「회신 Excel 가져오기」: ID 로 항목을 찾아 측정값을 넣고 수급 상태를 「검증 필요」로. 모르는 ID 는 unknown 으로.
// 원래 progress 는 바꾸지 않고 새 객체를 돌려준다.
export function importReply(C, prog, rows) {
  const ids = new Set(C.items.map(i => i.id)), col = HEADERS.indexOf('측정값'), next = structuredClone(prog ?? {}), unknown = [];
  let updated = 0;
  for (const r of rows) {
    const id = String(r[0] ?? '').trim(), v = r[col];
    if (!id || id === 'ID') continue;
    if (!ids.has(id)) { unknown.push(id); continue; }
    if (v === undefined || v === null || String(v).trim() === '') continue;
    next[id] = { ...next[id], value: String(v).trim(), supply: 'verify_needed', verify: next[id]?.verify ?? 'unverified' };
    updated++;
  }
  return { progress: next, updated, unknown };
}

// 「초기화」: 모든 항목을 처음 상태로
export const resetProgress = () => ({});
