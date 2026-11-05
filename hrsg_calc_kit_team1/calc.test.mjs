// 계산기 기대값 테스트: node --test calc.test.mjs  (두 팀 공통)
// 다른 언어(Python 등)로 옮겼다면 같은 입력으로 같은 값이 나오는지 이 숫자로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultInputs, designInputs, validateInputs, calculate, compareMethods, efficiencyTrend, lossCurve, keyIndicators,
  saturationTempC, formatKrw, toMbar } from './calc.js';

const D = JSON.parse(readFileSync(new URL('./data/calculator.json', import.meta.url), 'utf8'));
const near = (x, y, tol) => assert.ok(Math.abs(x - y) <= tol, `${x} != ${y} (±${tol})`);

test('기본값(예시 운전 상태): 손실, 금액, 지수, 효율', () => {
  const r = calculate(defaultInputs(D), D);
  near(r.loss.gt_mw, 1.08, 1e-9);                 // 270 MW × 0.08 %/mbar × 초과 5 mbar
  near(r.loss.st_mw, 0.81, 1e-9);                 // 135 MW × 0.12 %/°C × 5 °C
  assert.equal(formatKrw(r.annual_loss_krw), '22.68억 원');   // 1.89 MW × 8,000 h × 150 원/kWh
  assert.equal(formatKrw(r.monthly_loss_krw), '2.04억 원');   // 1.89 MW × 720 h × 150 원/kWh
  near(r.excess_pressure.mmh2o, 50.99, 0.01);
  assert.equal(r.indicators.hrsg_dp_mbar.level, 'caution');
  assert.equal(r.overall_level, 'caution');
  near(r.index.value, 41.15, 0.01);
  near(r.index.pressure_part, 33.33, 0.01);
  near(r.index.temp_part, 7.81, 0.01);
  near(r.efficiency.now, 0.8632, 0.0001);
  near(r.efficiency.after, 0.8671, 0.0001);
  near(r.default_method.recovered_mw, 0.8505, 1e-9);   // 기계식 세정 회수율 45%
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.input_warnings, []);
});

test('기본값: 공법 비교 — 회수기간 최단 드라이아이스, 순편익 최대 화학', () => {
  const { rows, best_payback_id, max_net_benefit_id } = compareMethods(defaultInputs(D), D);
  assert.equal(best_payback_id, 'dryice');
  assert.equal(max_net_benefit_id, 'chemical');
  const m = rows[0];
  assert.equal(m.id, 'mechanical');
  assert.equal(formatKrw(m.outage_loss_krw), '1.75억 원');   // 405 MW × 6일 × 24 h × 150 원/kWh × 2%
  assert.equal(formatKrw(m.total_investment_krw), '3.25억 원');
  near(m.payback_months, 3.54, 0.005);
  const k = calculate(defaultInputs(D), D).kpi;
  assert.equal(k.method_name, '드라이아이스 세정');
  near(k.payback_months, 3.12, 0.005);
  near(k.breakeven_days, 93.6, 0.05);
});

test('설계 상태: 손실 0, 지수 0, 회수기간 산출 불가', () => {
  const r = calculate(designInputs(D), D);
  assert.equal(r.loss.total_mw, 0);
  assert.equal(r.index.value, 0);
  assert.equal(r.overall_level, 'normal');
  near(r.efficiency.now, 0.8718, 0.0001);
  assert.ok(r.methods.rows.every(x => x.payback_months === null));
  assert.equal(r.methods.max_net_benefit_id, null);
});

test('단위가 달라도 같은 결과: mmH₂O·kPa 입력, 원/MWh, 문자열', () => {
  const inp = defaultInputs(D);
  const { gt_bp_mbar, hrsg_dp_mbar, ...rest } = inp.equipment;
  inp.equipment = { ...rest, gt_bp_mmh2o: String(gt_bp_mbar / 0.0980665), hrsg_dp_kpa: hrsg_dp_mbar / 10, stack_c: '95', load_pct: '100' };
  inp.economics = { price_krw_per_mwh: 150000, annual_hours: 8000, monthly_hours: 720 };
  const r = calculate(inp, D);
  near(r.loss.total_mw, 1.89, 1e-9);
  assert.deepEqual(r.input_warnings, []);
});

test('화면 입력값으로 기준·정격 바꾸기, 공법 직접 입력, 회수 출력 경고', () => {
  const inp = defaultInputs(D);
  Object.assign(inp.equipment, { rated_gt_mw: 150, base_stack_c: 95 });                      // 스택 설계 95 → 스택 초과 0
  inp.methods = [{ id: 'dryice', name: '드라이아이스 세정', cost_krw: 35000000, outage_days: 2, indirect_krw: 0, recovery_ratio: null, recovery_mw: null },
    { id: 'hp_water', name: '고압수 세정', cost_krw: null, outage_days: null, indirect_krw: null, recovery_ratio: null, recovery_mw: null }];
  inp.economics.target_recovery_mw = 2.1;
  const r = calculate(inp, D);
  near(r.loss.total_mw, 0.6, 1e-9);               // 150 × 0.0008 × 5
  assert.equal(r.methods.rows[0].recovery_basis, 'target');
  assert.equal(r.methods.rows[1].message, '산출 불가 — 입력 필요: 세정 비용, 정지일수, 간접 비용');
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].startsWith('드라이아이스 세정의 회수 출력(2.1 MW)이 현재 출력 손실(0.6 MW)보다 큽니다.'));
});

test('입력 검사: 빠진 값·다른 이름·두 단위·단위 의심', () => {
  const bad = defaultInputs(D);
  delete bad.equipment.gt_bp_mbar; bad.equipment.backpressure = 413;
  bad.equipment.hrsg_dp_kpa = 3;                  // hrsg_dp 가 mbar·kPa 두 번
  bad.economics.price_krw_per_kwh = 150000;       // 원/MWh 값을 원/kWh 키에
  bad.equipment.gt_class = 'G';
  const v = validateInputs(bad, D);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.startsWith('equipment.gt_class (가스터빈 등급) 값 "G" 를 모릅니다.')));
  assert.ok(v.errors.some(e => e.startsWith('equipment.gt_bp_<단위> (GT 배압(현재 배압)) 값이 없습니다.')));
  assert.ok(v.errors.some(e => e.startsWith('equipment.hrsg_dp 가 두 단위로 들어왔습니다')));
  assert.ok(v.warnings.some(w => w.startsWith('equipment.backpressure 는 키트가 쓰지 않는 이름')));
  assert.ok(v.warnings.some(w => w.includes('price_krw_per_mwh 에 넣어 주세요')));
  assert.throws(() => calculate(bad, D), /계산기 입력이 키트 형식과 맞지 않습니다/);
  const mm = defaultInputs(D); delete mm.equipment.gt_bp_mbar; mm.equipment.gt_bp_mbar = 413;   // mmH₂O 값을 mbar 키에
  assert.ok(validateInputs(mm, D).warnings.some(w => w.includes('너무 큽니다')));
});

test('효율 추이 13점, 압력-손실 곡선', () => {
  const t = efficiencyTrend(defaultInputs(D), D);
  assert.equal(t.months.length, 13);
  near(t.months[12].eff, 0.8632, 0.0001);
  const c = lossCurve(defaultInputs(D), D, { param: 'hrsg_dp' });
  assert.equal(c.points[0].loss_mw, 0.81);        // 차압 15 mbar: 스택 초과분만
  near(c.points.at(-1).loss_mw, 0.81 + 270 * 0.0008 * 15, 1e-9);
  assert.equal(lossCurve(defaultInputs(D), D, { param: 'gt_bp' }).current.mbar, 30);
});

test('핀치·어프로치 3섹션, 핵심 성능 지표', () => {
  near(saturationTempC(0.1), 99.606, 0.001);
  near(saturationTempC(10), 310.999, 0.001);
  const k = keyIndicators(defaultInputs(D), D);
  assert.deepEqual(k.sections.map(s => s.level), ['normal', 'no_data', 'no_data']);
  near(k.kpi.hp_pinch_c.value, 8, 0.1);
  assert.equal(k.kpi.hp_steam_tph.value, 270);
  assert.equal(k.kpi.cleaning_cost_krw.method, '기계식 세정');
  const inp = defaultInputs(D); inp.sections.HP.econ_outlet_water_c += 6;
  assert.equal(keyIndicators(inp, D).sections[0].level, 'danger');   // 어프로치 < 0 → 스티밍
  near(toMbar(1, 'inh2o'), 2.49089, 1e-9);
});
