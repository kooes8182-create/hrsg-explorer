// 체크리스트 기대값 테스트: node --test checklist.test.mjs  (두 팀 공통)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kpis, byCategory, summary, distribution, matrix, filterItems, priorityLabel, measureCell, detailLine,
  emailDraft, exportRows, importReply, validateProgress } from './checklist.js';

const C = JSON.parse(readFileSync(new URL('./data/checklist.json', import.meta.url), 'utf8'));

test('처음 상태: 49개, 필수 16개, 카테고리별 개수', () => {
  const k = kpis(C, {});
  assert.deepEqual(k.received, { done: 0, total: 49, percent: 0 });
  assert.deepEqual(k.required, { done: 0, total: 16, percent: 0 });
  assert.deepEqual(byCategory(C, {}).map(c => `${c.name} ${c.done}/${c.total}`),
    ['A. 가스터빈/운전 0/6', 'B. HRSG 열역학/설계 0/13', 'C. 세정/유지보수 0/9', 'D. 경제성 0/3', 'E. 확장 0/18']);
  assert.deepEqual(summary(C, {}).all, k.received);
  assert.equal(C.items.filter(i => i.calc_input).length, 22);   // 「계산기 입력에 사용됨」
});

test('분포, 미수령 필수 항목, 범주 × 상태', () => {
  const d = distribution(C, {});
  assert.deepEqual(d.supply, { not_entered: 49, requested: 0, received: 0, verify_needed: 0, na: 0 });
  assert.equal(d.missing_required.join(' '), 'A-01 A-02 A-03 A-04 A-05 B-01 B-02 B-05 B-06 B-07 B-08 D-01 D-03 E-01 E-13 E-16');
  assert.deepEqual(matrix(C, {}).map(r => r.counts.not_entered), [6, 13, 9, 3, 18]);
});

test('수령·검증·해당 없음 반영', () => {
  const prog = { 'A-01': { supply: 'received', verify: 'verified', reviewed: true }, 'A-02': { supply: 'verify_needed', verify: 'failed' },
    'B-13': { supply: 'na' }, 'B-03': { supply: 'requested' } };
  const k = kpis(C, prog);
  assert.deepEqual(k.received, { done: 2, total: 48, percent: 4 });   // 해당 없음은 분모에서 빠짐
  assert.equal(k.reviewed.done, 1);
  assert.equal(k.verified.done, 1);
  assert.equal(k.required.done, 1);                                   // A-02 는 검증 실패라 충족 아님
  assert.equal(distribution(C, prog).missing_required[0], 'A-03');
});

test('필터, 배지, 측정값 칸', () => {
  assert.equal(filterItems(C, {}).length, 49);
  assert.equal(filterItems(C, {}, { requiredOnly: true }).length, 16);
  assert.equal(filterItems(C, {}, { category: 'D' }).length, 3);
  assert.equal(filterItems(C, {}, { query: 'e-16' }).length, 1);
  assert.equal(filterItems(C, { 'A-01': { supply: 'received' }, 'B-13': { supply: 'na' } }, { incompleteOnly: true }).length, 47);
  const a02 = C.items.find(i => i.id === 'A-02'), b13 = C.items.find(i => i.id === 'B-13');
  assert.equal(priorityLabel(C, a02), '필수 · 높음');
  assert.equal(priorityLabel(C, a02, 'simple'), '필수');
  assert.equal(priorityLabel(C, b13, 'simple'), '선택');
  assert.equal(measureCell(b13, {}), '문서');
  assert.equal(measureCell(a02, { 'A-02': { value: '405' } }), '405');
  assert.equal(detailLine(a02), '초과 배압과 출력 손실 계산 · 단위 mmH₂O 또는 mbar');
});

test('메일 문구: 선택 항목 / 미수령 전체', () => {
  const t = emailDraft(C, {}, { ids: ['A-02', 'D-01'], plant: 'A 발전소' });
  assert.ok(t.startsWith('A 발전소 HRSG 성능 진단을 위해'));
  assert.ok(t.includes('- A-02 운전 배압 (mmH₂O 또는 mbar) — 초과 배압과 출력 손실 계산 [필수]'));
  assert.ok(t.includes('[D. 경제성]') && !t.includes('[C. 세정/유지보수]'));
  const all = emailDraft(C, { 'A-01': { supply: 'received' } });
  assert.ok(!all.includes('A-01 ') && all.includes('- E-18 '));
});

test('내보내기, 회신 가져오기', () => {
  const rows = exportRows(C, {}, { template: true });
  assert.equal(rows.length, 49);
  rows[1][7] = '405';
  const r = importReply(C, {}, [['ID'], ...rows, ['Z-99', '', '', '', '', '', '', '1']]);
  assert.equal(r.updated, 1);
  assert.deepEqual(r.unknown, ['Z-99']);
  assert.deepEqual(r.progress['A-02'], { value: '405', supply: 'verify_needed', verify: 'unverified' });
});

test('진행 상태 검사: 모르는 ID, 화면 글자, 모르는 필드', () => {
  assert.equal(validateProgress(C, { 'A-01': { supply: 'received', verify: 'verified', reviewed: true } }).ok, true);
  const v = validateProgress(C, { gt_model: { supply: 'received' }, 'A-02': { supply: '수령 완료', status: 'x' }, 'A-03': { supply: '해당 없음' } });
  assert.equal(v.errors.length, 3);
  assert.ok(v.errors[0].startsWith('항목 ID gt_model 는 체크리스트에 없습니다'));
  assert.ok(v.errors[1].includes('"received"'));
  assert.ok(v.errors[2].includes('"na"'));
  assert.ok(v.warnings[0].startsWith('A-02.status'));
});
