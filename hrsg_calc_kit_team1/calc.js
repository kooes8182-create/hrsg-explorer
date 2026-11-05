// HRSG 성능·경제성 계산기 로직 — 두 팀 공통 (common-0.2). 화면과 무관한 순수 함수. 값은 data/calculator.json(DEMO 값)에서 받는다.
// 브라우저(<script type="module">), Node, React/Vue/Svelte 어디서나 import 해서 쓴다. 외부 라이브러리 없음.
//
// 입력 한 벌(inp) = defaultInputs(D) 의 모양. 압력은 키 이름 끝의 단위로 받는다(_mbar · _mmh2o · _kpa · _inh2o 중 하나).
//   equipment: { gt_class, load_pct, gt_bp_<단위>, hrsg_dp_<단위>, stack_c,                 ← 필수
//                rated_gt_mw, rated_st_mw, base_gt_bp_<단위>, base_hrsg_dp_<단위>, base_stack_c, ← 선택: 없으면 GT 등급의 값
//                gt_exhaust_c, exhaust_flow_kgs, ambient_c }                                  ← 선택: 없으면 열회수 효율은 null
//   economics: { price_krw_per_kwh 또는 price_krw_per_mwh, monthly_hours, annual_hours, target_recovery_mw }
//   methods:   [{ id, name, cost_krw, outage_days, indirect_krw, recovery_ratio, recovery_mw }]
//   sections:  { HP: { drum_barg, evap_outlet_gas_c, econ_outlet_water_c, pinch_design_c?, approach_design_c? } | null, IP, LP }
//   hp_steam_tph
// 결과의 압력은 mbar 와 mmH₂O 를 함께 준다(_mbar, _mmh2o).

const clamp01 = x => Math.min(1, Math.max(0, x));
const isNum = v => v !== null && v !== '' && v !== undefined && Number.isFinite(+v);
const num = v => (isNum(v) ? +v : null);
const RANK = { normal: 0, caution: 1, danger: 2 };
export const worst = levels => levels.reduce((w, l) => (RANK[l] > RANK[w] ? l : w), 'normal');

// 압력 단위: 1 mmH₂O = 0.0980665 mbar, 1 kPa = 10 mbar, 1 inH₂O = 2.49089 mbar
export const PRESSURE_UNITS = { mbar: 1, mmh2o: 0.0980665, kpa: 10, inh2o: 2.49089 };
export const toMbar = (v, unit) => v * PRESSURE_UNITS[unit];
export const fromMbar = (mbar, unit) => mbar / PRESSURE_UNITS[unit];
const both = mbar => ({ mbar, mmh2o: fromMbar(mbar, 'mmh2o') });
// equipment 에서 gt_bp_mmh2o 처럼 단위가 붙은 압력 키를 찾는다 → [{ unit, value }]
const pressureKeys = (obj, base) => Object.keys(PRESSURE_UNITS).filter(u => obj?.[`${base}_${u}`] !== undefined).map(u => ({ unit: u, value: obj[`${base}_${u}`] }));

const satFromSections = (D, label) => saturationTempCFromBarg(D.pinch.default_drum_barg[label]);

// 「기본값」: 예시 운전 상태(default_case). 압력은 mbar 키로 채운다.
export function defaultInputs(D, overrides = {}) {
  const c = D.default_case, cls = D.gt_classes.find(g => g.id === (overrides.gt_class ?? c.gt_class));
  const sections = {};
  for (const label of Object.keys(D.pinch.design)) {
    if (!D.pinch.default_data_sections.includes(label)) { sections[label] = null; continue; }
    const t = satFromSections(D, label), d = D.pinch.design[label];
    sections[label] = { drum_barg: D.pinch.default_drum_barg[label], evap_outlet_gas_c: +(t + d.pinch_c).toFixed(1), econ_outlet_water_c: +(t - d.approach_c).toFixed(1) };
  }
  return structuredClone({
    equipment: { gt_class: cls.id, ...cls.operation, gt_bp_mbar: c.gt_bp_mbar, hrsg_dp_mbar: c.hrsg_dp_mbar, stack_c: c.stack_c },
    economics: D.economics, methods: D.methods, sections, hp_steam_tph: cls.hp_steam_tph,
  });
}
// 설계 상태(손실 0): GT 등급의 설계값으로 채운 입력 (「초기화」 버튼)
export function designInputs(D, classId = D.default_case.gt_class) {
  const inp = defaultInputs(D, { gt_class: classId }), I = D.gt_classes.find(g => g.id === classId).indicators;
  Object.assign(inp.equipment, { gt_bp_mbar: I.gt_bp_mbar.design, hrsg_dp_mbar: I.hrsg_dp_mbar.design, stack_c: I.stack_c.design });
  return inp;
}

// ───────── 입력 검사 ─────────
const EQUIP_NUM = { load_pct: ['운전 부하율', '%', true], stack_c: ['스택 온도', '°C', true], rated_gt_mw: ['GT 정격 출력', 'MW'], rated_st_mw: ['ST 정격 출력', 'MW'],
  base_stack_c: ['기준(설계) 스택 온도', '°C'], gt_exhaust_c: ['GT 배기 온도', '°C'], exhaust_flow_kgs: ['배기가스 유량', 'kg/s'], ambient_c: ['외기 온도', '°C'] };
const PRESSURES = { gt_bp: ['GT 배압(현재 배압)', true], hrsg_dp: ['HRSG 가스측 차압', true], base_gt_bp: ['기준(설계) GT 배압', false], base_hrsg_dp: ['기준(설계) HRSG 차압', false] };
const ECON_NUM = { monthly_hours: ['월간 가동시간', 'h'], annual_hours: ['연간 운전 시간', 'h'], target_recovery_mw: ['목표 회수 출력', 'MW'] };
const METHOD_NUM = { cost_krw: ['세정 비용', '원'], outage_days: ['정지일수', '일'], indirect_krw: ['간접 비용', '원'], recovery_ratio: ['회수율', '0~1'], recovery_mw: ['회수 출력', 'MW'] };
const SECTION_NUM = { drum_barg: ['드럼 압력', 'barg'], evap_outlet_gas_c: ['증발기 출구 가스 온도', '°C'], econ_outlet_water_c: ['절탄기 출구 급수 온도', '°C'],
  pinch_design_c: ['핀치 설계값', '°C'], approach_design_c: ['어프로치 설계값', '°C'] };

// 내 화면 상태를 어댑터로 바꾼 결과가 키트 입력 모양과 맞는지 확인한다.
// errors: 계산할 수 없음(빠진 값, 숫자가 아닌 값, 모르는 GT 등급) → calculate() 가 오류를 낸다.
// warnings: 계산은 되지만 이름이 틀렸거나 단위가 다를 수 있음.
export function validateInputs(inp, D) {
  const errors = [], warnings = [];
  const checkNums = (obj, spec, path) => {
    for (const [k, [label, unit, req]] of Object.entries(spec)) {
      const v = obj?.[k], where = `${path}.${k} (${label}, ${unit})`;
      if (v === undefined || v === null || v === '') { if (req) errors.push(`${where} 값이 없습니다.`); continue; }
      if (!isNum(v)) errors.push(`${where} 숫자가 아닙니다: ${JSON.stringify(v)}`);
    }
  };
  const unknown = (obj, known, path) => { for (const k of Object.keys(obj ?? {})) if (!known(k) && !k.startsWith('_')) warnings.push(`${path}.${k} 는 키트가 쓰지 않는 이름입니다. 오타이거나 다른 이름으로 바꿔야 하는지 확인해 주세요.`); };

  const eq = inp?.equipment;
  if (!eq || typeof eq !== 'object') errors.push('equipment 묶음이 없습니다.');
  else {
    if (!D.gt_classes.some(g => g.id === eq.gt_class)) errors.push(`equipment.gt_class (가스터빈 등급) 값 ${JSON.stringify(eq.gt_class)} 를 모릅니다. 가능한 값: ${D.gt_classes.map(g => g.id).join(', ')}`);
    checkNums(eq, EQUIP_NUM, 'equipment');
    for (const [base, [label, req]] of Object.entries(PRESSURES)) {
      const found = pressureKeys(eq, base), units = Object.keys(PRESSURE_UNITS).map(u => `${base}_${u}`).join(' / ');
      if (found.length === 0) { if (req) errors.push(`equipment.${base}_<단위> (${label}) 값이 없습니다. ${units} 중 하나로 넣어 주세요.`); continue; }
      if (found.length > 1) errors.push(`equipment.${base} 가 두 단위로 들어왔습니다(${found.map(f => base + '_' + f.unit).join(', ')}). 하나만 넣어 주세요.`);
      for (const f of found) if (!isNum(f.value)) errors.push(`equipment.${base}_${f.unit} (${label}) 숫자가 아닙니다: ${JSON.stringify(f.value)}`);
    }
    const knownEq = k => k === 'gt_class' || k in EQUIP_NUM || Object.keys(PRESSURES).some(b => Object.keys(PRESSURE_UNITS).some(u => k === `${b}_${u}`));
    unknown(eq, knownEq, 'equipment');
  }

  const ec = inp?.economics;
  if (!ec || typeof ec !== 'object') errors.push('economics 묶음이 없습니다.');
  else {
    const prices = ['price_krw_per_kwh', 'price_krw_per_mwh'].filter(k => isNum(ec[k]));
    if (prices.length === 0) errors.push('economics.price_krw_per_kwh (SMP, 원/kWh) 또는 price_krw_per_mwh (전력 단가, 원/MWh) 중 하나가 필요합니다.');
    if (prices.length === 2) errors.push('전력 단가가 원/kWh 와 원/MWh 로 두 번 들어왔습니다. 하나만 넣어 주세요.');
    checkNums(ec, ECON_NUM, 'economics');
    if (!isNum(ec.monthly_hours) && !isNum(ec.annual_hours)) errors.push('economics.monthly_hours (월간 가동시간) 또는 annual_hours (연간 운전 시간) 중 하나가 필요합니다.');
    unknown(ec, k => k in ECON_NUM || k === 'price_krw_per_kwh' || k === 'price_krw_per_mwh', 'economics');
  }

  if (!Array.isArray(inp?.methods)) errors.push('methods 는 세정 공법 배열이어야 합니다.');
  else inp.methods.forEach((m, i) => {
    if (!m?.id || !m?.name) errors.push(`methods[${i}] 에 id 와 name 이 필요합니다.`);
    checkNums(m, METHOD_NUM, `methods[${i}]`);
    unknown(m, k => k === 'id' || k === 'name' || k in METHOD_NUM, `methods[${i}]`);
    if (isNum(m?.recovery_ratio) && +m.recovery_ratio > 1) warnings.push(`methods[${i}].recovery_ratio 가 1 보다 큽니다. % 가 아니라 0~1 비율로 넣어 주세요 (예: 0.45).`);
  });

  if (inp?.sections != null) for (const [label, s] of Object.entries(inp.sections)) {
    if (!(label in D.pinch.design)) { warnings.push(`sections.${label} 는 키트가 쓰지 않는 섹션입니다 (HP, IP, LP).`); continue; }
    if (s == null) continue;
    checkNums(s, SECTION_NUM, `sections.${label}`);
    unknown(s, k => k in SECTION_NUM, `sections.${label}`);
  }
  unknown(inp, k => ['equipment', 'economics', 'methods', 'sections', 'hp_steam_tph'].includes(k), 'inp');

  // 단위를 잘못 넣었을 때 자주 나오는 값 (경고만)
  const hint = (cond, msg) => { if (cond) warnings.push(msg); };
  hint(isNum(eq?.load_pct) && +eq.load_pct > 0 && +eq.load_pct <= 1.5, 'equipment.load_pct: 부하율이 0~1 비율로 들어온 것 같습니다. % 로 넣어 주세요 (예: 100).');
  for (const base of ['gt_bp', 'hrsg_dp', 'base_gt_bp', 'base_hrsg_dp']) for (const f of pressureKeys(eq, base)) if (isNum(f.value)) {
    const mbar = toMbar(+f.value, f.unit);
    hint(mbar > 150, `equipment.${base}_${f.unit}: ${mbar.toFixed(0)} mbar 는 너무 큽니다. 다른 단위 값을 _${f.unit} 키에 넣은 것 아닌지 확인해 주세요.`);
    hint(mbar > 0 && mbar < 3, `equipment.${base}_${f.unit}: ${mbar.toFixed(2)} mbar 는 너무 작습니다. 다른 단위 값을 _${f.unit} 키에 넣은 것 아닌지 확인해 주세요.`);
  }
  hint(isNum(ec?.price_krw_per_kwh) && +ec.price_krw_per_kwh > 1000, 'economics.price_krw_per_kwh 가 너무 큽니다. 원/MWh 값이면 price_krw_per_mwh 에 넣어 주세요.');
  hint(isNum(ec?.price_krw_per_mwh) && +ec.price_krw_per_mwh < 1000, 'economics.price_krw_per_mwh 가 너무 작습니다. 원/kWh 값이면 price_krw_per_kwh 에 넣어 주세요.');
  hint(isNum(ec?.monthly_hours) && +ec.monthly_hours > 744, 'economics.monthly_hours 가 한 달(744 h)보다 깁니다. 연간 시간이면 annual_hours 에 넣어 주세요.');
  hint(isNum(ec?.annual_hours) && +ec.annual_hours <= 744, 'economics.annual_hours 가 한 달 이하입니다. 월간 시간이면 monthly_hours 에 넣어 주세요.');
  return { ok: errors.length === 0, errors, warnings };
}

// ───────── 내부 표준형 (mbar, 원/MWh, 숫자) ─────────
export function normalize(inp, D) {
  const eq = inp.equipment, ec = inp.economics, cls = D.gt_classes.find(g => g.id === eq.gt_class);
  const p = base => { const f = pressureKeys(eq, base).find(x => isNum(x.value)); return f ? toMbar(+f.value, f.unit) : null; };
  const ind = structuredClone(cls.indicators);
  const rebase = (k, v) => { if (v === null) return; const d = v - ind[k].design; for (const t of ['design', 'caution', 'danger', 'min', 'max']) ind[k][t] += d; };
  rebase('gt_bp_mbar', p('base_gt_bp')); rebase('hrsg_dp_mbar', p('base_hrsg_dp')); rebase('stack_c', num(eq.base_stack_c));
  const monthly = num(ec.monthly_hours), annual = num(ec.annual_hours);
  return {
    cls, ind,
    rated_gt_mw: num(eq.rated_gt_mw) ?? cls.rated_gt_mw, rated_st_mw: num(eq.rated_st_mw) ?? cls.rated_st_mw,
    load: num(eq.load_pct) / 100, gt_bp_mbar: p('gt_bp'), hrsg_dp_mbar: p('hrsg_dp'), stack_c: num(eq.stack_c),
    gt_exhaust_c: num(eq.gt_exhaust_c), ambient_c: num(eq.ambient_c),
    price_krw_per_mwh: isNum(ec.price_krw_per_mwh) ? +ec.price_krw_per_mwh : num(ec.price_krw_per_kwh) * 1000,
    monthly_hours: monthly ?? annual / 12, annual_hours: annual ?? monthly * 12,
    target_recovery_mw: num(ec.target_recovery_mw),
    methods: inp.methods.map(m => ({ id: m.id, name: m.name, ...Object.fromEntries(Object.keys(METHOD_NUM).map(k => [k, num(m[k])])) })),
    sections: inp.sections ?? {}, hp_steam_tph: num(inp.hp_steam_tph),
  };
}

// ───────── 손실·금액 ─────────
export const indicatorLevel = (ind, v) => (v >= ind.danger ? 'danger' : v >= ind.caution ? 'caution' : 'normal');
const excessRatio = (ind, v) => clamp01((v - ind.design) / (ind.danger - ind.design));
const VALUES = N => ({ gt_bp_mbar: N.gt_bp_mbar, hrsg_dp_mbar: N.hrsg_dp_mbar, stack_c: N.stack_c });

// 초과 압력 = 두 압력(GT 배압, HRSG 차압) 중 설계 초과분이 더 큰 것 (이중 계산 방지)
const excessBp = (N, v) => Math.max(0, v.hrsg_dp_mbar - N.ind.hrsg_dp_mbar.design, v.gt_bp_mbar - N.ind.gt_bp_mbar.design);
// 출력 손실 [MW]: GT = GT 정격 × 0.08 %/mbar × 초과 압력 × 부하, ST = ST 정격 × 0.12 %/°C × 스택 초과 × 부하
function powerLoss(N, K, v = VALUES(N)) {
  const dStack = Math.max(0, v.stack_c - N.ind.stack_c.design);
  const gt = N.rated_gt_mw * K.gt_loss_pct_per_mbar / 100 * excessBp(N, v) * N.load;
  const st = N.rated_st_mw * K.st_loss_pct_per_c / 100 * dStack * N.load;
  return { gt_mw: gt, st_mw: st, total_mw: gt + st };
}
// 세정 후 값: 세 지표 모두 설계 초과분이 회수율만큼 줄어든다
const afterCleaning = (N, r, v = VALUES(N)) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x - r * Math.max(0, x - N.ind[k].design)]));
const monthlyKrw = (N, mw) => mw * N.monthly_hours * N.price_krw_per_mwh;
const annualKrw = (N, mw) => mw * N.annual_hours * N.price_krw_per_mwh;
// 열회수 효율 = (배기온도 − 스택온도) / (배기온도 − 외기온도). 배기·외기 온도가 없으면 null
const eff = (N, stack) => (N.gt_exhaust_c === null || N.ambient_c === null ? null : (N.gt_exhaust_c - stack) / (N.gt_exhaust_c - N.ambient_c));

// 공법 하나. 비용·정지일수·간접 비용 중 비어 있으면 「산출 불가 — 입력 필요: …」
// 회수 출력: recovery_mw 가 있으면 그 값 → 없으면 recovery_ratio 로 계산 → 둘 다 없으면 목표 회수 출력
function methodRow(N, K, m, lossNow) {
  const missing = [['cost_krw', '세정 비용'], ['outage_days', '정지일수'], ['indirect_krw', '간접 비용']].filter(([k]) => m[k] === null).map(([, l]) => l);
  if (missing.length) return { id: m.id, name: m.name, available: false, missing, message: `산출 불가 — 입력 필요: ${missing.join(', ')}` };
  let recovered, basis;
  if (m.recovery_mw !== null) { recovered = m.recovery_mw; basis = 'mw'; }
  else if (m.recovery_ratio !== null) { recovered = lossNow - powerLoss(N, K, afterCleaning(N, m.recovery_ratio)).total_mw; basis = 'ratio'; }
  else if (N.target_recovery_mw !== null) { recovered = N.target_recovery_mw; basis = 'target'; }
  else return { id: m.id, name: m.name, available: false, missing: ['회수 출력'], message: '산출 불가 — 입력 필요: 회수 출력(또는 회수율·목표 회수 출력)' };
  // 정지 손실 = (GT + ST 정격) × 부하 × 정지일수 × 24 h × 전력 단가 × 마진율 (DEMO: 정지 중 잃는 마진만 비용으로 봄)
  const outage = (N.rated_gt_mw + N.rated_st_mw) * N.load * m.outage_days * 24 * N.price_krw_per_mwh * K.outage_margin_ratio;
  const total = m.cost_krw + m.indirect_krw + outage, monthly = monthlyKrw(N, recovered), annual = annualKrw(N, recovered);
  const payback = monthly > 0 ? total / monthly : null;   // null → 「산출 불가」
  return {
    id: m.id, name: m.name, available: true,
    cost_krw: m.cost_krw, outage_days: m.outage_days, indirect_krw: m.indirect_krw, recovery_ratio: m.recovery_ratio,
    recovered_mw: recovered, recovery_basis: basis,   // 'mw' | 'ratio' | 'target'
    monthly_benefit_krw: monthly, annual_benefit_krw: annual, outage_loss_krw: outage, total_investment_krw: total,
    payback_months: payback, breakeven_days: payback === null ? null : payback * N.monthly_hours / 24,
    first_month_net_krw: monthly - total, annual_net_krw: annual - total,
  };
}

// 세정 공법별 비교. sortBy: 'payback'(회수기간 짧은 순) | 'total'(총투자 적은 순) | 'net'(첫 달 순편익 큰 순) | 'annual_net'(연간 순편익 큰 순) | 'none'
export function compareMethods(inp, D, sortBy = 'none') {
  const N = normalize(inp, D), K = D.constants, lossNow = powerLoss(N, K).total_mw;
  const rows = N.methods.map(m => methodRow(N, K, m, lossNow)), ok = rows.filter(r => r.available);
  const key = { payback: r => r.payback_months ?? Infinity, total: r => r.total_investment_krw, net: r => -r.first_month_net_krw, annual_net: r => -r.annual_net_krw }[sortBy];
  const sorted = key ? [...ok].sort((a, b) => key(a) - key(b)).concat(rows.filter(r => !r.available)) : rows;
  const fastest = ok.filter(r => r.payback_months !== null).sort((a, b) => a.payback_months - b.payback_months)[0];
  const maxNet = ok.sort((a, b) => b.annual_net_krw - a.annual_net_krw)[0];
  return {
    rows: sorted,
    best_payback_id: fastest?.id ?? null,                                       // 「회수기간이 가장 짧은 공법 (추천 아님)」
    max_net_benefit_id: maxNet && maxNet.annual_net_krw > 0 ? maxNet.id : null, // 「순편익 최대」(모두 0 이하면 null)
  };
}

// 「계산 실행」: 화면에 필요한 결과 전부. 입력이 키트 형식과 다르면 계산하지 않고 오류를 낸다.
export function calculate(inp, D) {
  const check = validateInputs(inp, D);
  if (!check.ok) throw new TypeError('계산기 입력이 키트 형식과 맞지 않습니다.\n- ' + check.errors.join('\n- '));
  const N = normalize(inp, D), K = D.constants, v = VALUES(N);
  const loss = powerLoss(N, K), dBp = excessBp(N, v), dStack = Math.max(0, N.stack_c - N.ind.stack_c.design);
  const indicators = Object.fromEntries(Object.entries(N.ind).map(([k, ind]) => [k, { ...ind, value: v[k], level: indicatorLevel(ind, v[k]) }]));
  const overall = worst(Object.values(indicators).map(i => i.level));

  // 기본 공법(constants.default_method)으로 세정했을 때 (팀 2 탭 1 「세정 시 회수효과」)
  const dm = N.methods.find(m => m.id === K.default_method) ?? N.methods[0];
  const after = afterCleaning(N, dm?.recovery_ratio ?? 0), lossAfter = powerLoss(N, K, after);
  const recoveredDefault = loss.total_mw - lossAfter.total_mw;

  // 세정 필요도(오염) 지수 0~100 = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도) 의 초과 비율
  const W = K.index_weights, x = k => excessRatio(N.ind[k], v[k]);
  const pressurePart = 100 * (W.hrsg_dp_mbar * x('hrsg_dp_mbar') + W.gt_bp_mbar * x('gt_bp_mbar')), tempPart = 100 * W.stack_c * x('stack_c');

  const cmp = compareMethods(inp, D), best = cmp.rows.find(r => r.id === cmp.best_payback_id) ?? null;
  const warnings = cmp.rows.filter(r => r.available && r.recovery_basis !== 'ratio' && r.recovered_mw > loss.total_mw)
    .map(r => `${r.name}의 회수 출력(${round(r.recovered_mw, 2)} MW)이 현재 출력 손실(${round(loss.total_mw, 3)} MW)보다 큽니다. 잃은 출력보다 많이 회수한다는 가정이므로 입력을 확인하세요.`);
  const gaugeMax = Math.max(N.ind.gt_bp_mbar.max - N.ind.gt_bp_mbar.design, N.ind.hrsg_dp_mbar.max - N.ind.hrsg_dp_mbar.design);

  return {
    indicators, overall_level: overall,
    loss, excess_pressure: both(dBp), excess_stack_c: dStack,
    monthly_loss_krw: monthlyKrw(N, loss.total_mw), annual_loss_krw: annualKrw(N, loss.total_mw),
    default_method: { id: dm?.id ?? null, name: dm?.name ?? null, recovered_mw: recoveredDefault,
      monthly_recovery_krw: monthlyKrw(N, recoveredDefault), annual_recovery_krw: annualKrw(N, recoveredDefault),
      recovery_vs_loss: loss.total_mw > 0 ? recoveredDefault / loss.total_mw : 0, values_after: after, loss_after: lossAfter },
    efficiency: { now: eff(N, N.stack_c), after: eff(N, after.stack_c), design: eff(N, N.ind.stack_c.design) },
    index: { value: pressurePart + tempPart, pressure_part: pressurePart, temp_part: tempPart },
    display_fouling: Object.fromEntries([['overall', x('hrsg_dp_mbar')], ...Object.entries(K.section_weights).map(([s, w]) => [s, clamp01(x('hrsg_dp_mbar') * w)])]),
    gauge: { value: both(dBp), max: both(gaugeMax), public_ref: K.public_ref_inh2o.map(i => both(toMbar(i, 'inh2o'))) },
    methods: cmp,
    kpi: {   // 팀 1 KPI 카드 10개 (공법 값은 회수기간이 가장 짧은 공법 기준)
      current_bp: both(N.gt_bp_mbar), excess_bp: both(dBp), power_loss_mw: loss.total_mw, monthly_loss_krw: monthlyKrw(N, loss.total_mw),
      expected_recovery_mw: best?.recovered_mw ?? null, investment_krw: best?.total_investment_krw ?? null, method_name: best?.name ?? null,
      monthly_benefit_krw: best?.monthly_benefit_krw ?? null, first_month_net_krw: best?.first_month_net_krw ?? null,
      payback_months: best?.payback_months ?? null, breakeven_days: best?.breakeven_days ?? null,
    },
    warnings, input_warnings: check.warnings,
  };
}

// 열회수 효율 추이: 운전 이력이 없으므로 설계 효율에서 현재 효율까지 12개월에 걸쳐 선형 저하했다고 가정한 13개 점 + 세정 후
export function efficiencyTrend(inp, D) {
  const { efficiency: e } = calculate(inp, D);
  if (e.now === null) return null;
  return { months: Array.from({ length: 13 }, (_, m) => ({ month: m, eff: e.design + (e.now - e.design) * m / 12 })), after_cleaning: e.after, design: e.design };
}

// 압력-손실 곡선: param('hrsg_dp' | 'gt_bp') 하나만 min~max 로 바꾸고 나머지 입력은 그대로
export function lossCurve(inp, D, { param = 'hrsg_dp', points = 31 } = {}) {
  const N = normalize(inp, D), K = D.constants, key = `${param}_mbar`, ind = N.ind[key], out = [];
  for (let i = 0; i < points; i++) {
    const val = ind.min + (ind.max - ind.min) * i / (points - 1), vals = { ...VALUES(N), [key]: val };
    out.push({ value: both(val), excess: both(Math.max(0, val - ind.design)), loss_mw: powerLoss(N, K, vals).total_mw });
  }
  return { points: out, current: both(N[key]), design: both(ind.design), caution: both(ind.caution), danger: both(ind.danger) };
}

// ───────── 핀치·어프로치 ─────────
// 포화온도: IAPWS-IF97 Region 4 (공개 공식). 절대압 MPa → °C
const IF97 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7,
  0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3];
export function saturationTempC(pMpa) {
  if (!(pMpa >= 611.213e-6 && pMpa <= 22.064)) throw new RangeError('압력은 0.000611~22.064 MPa(절대압) 범위여야 합니다.');
  const [n1, n2, n3, n4, n5, n6, n7, n8, n9, n10] = IF97, b = pMpa ** 0.25;
  const e = b * b + n3 * b + n6, f = n1 * b * b + n4 * b + n7, g = n2 * b * b + n5 * b + n8;
  const d = 2 * g / (-f - Math.sqrt(f * f - 4 * e * g));
  return (n10 + d - Math.sqrt((n10 + d) ** 2 - 4 * (n9 + n10 * d))) / 2 - 273.15;
}
export const saturationTempCFromBarg = barg => saturationTempC((barg + 1.01325) / 10);

// 섹션 하나(HP/IP/LP). 필요한 값이 없으면 「데이터 필요」(level 'no_data') + 체크리스트 「B. HRSG 열역학/설계」로 연결
export function pinchSection(label, data, D) {
  const K = D.constants, dd = D.pinch.design[label];
  const design = { pinch_c: num(data?.pinch_design_c) ?? dd.pinch_c, approach_c: num(data?.approach_design_c) ?? dd.approach_c };
  const base = { label, design, checklist_category: 'B' };
  if (!data || ['drum_barg', 'evap_outlet_gas_c', 'econ_outlet_water_c'].some(k => !isNum(data[k])))
    return { ...base, level: 'no_data', current: null, message: '평가에 필요한 운전 데이터가 없습니다.' };
  const tSat = saturationTempCFromBarg(+data.drum_barg), pinch = data.evap_outlet_gas_c - tSat, approach = tSat - data.econ_outlet_water_c, m = K.pinch_margin_c;
  if (pinch < 0) throw new RangeError(`${label}: 증발기 출구 가스 온도가 포화온도(${tSat.toFixed(1)} °C)보다 낮을 수 없습니다.`);
  const notes = [];
  let level = 'normal';
  if (approach < 0) { level = 'danger'; notes.push('절탄기 출구 급수가 포화온도를 넘었습니다 — 스티밍 우려.'); }
  if (pinch > design.pinch_c + m) { level = worst([level, 'caution']); notes.push(`핀치가 설계보다 ${(pinch - design.pinch_c).toFixed(1)} °C 큽니다 — 열 회수 저하 의심.`); }
  if (approach >= 0 && Math.abs(approach - design.approach_c) > m) { level = worst([level, 'caution']); notes.push(`어프로치가 설계와 ${(approach - design.approach_c).toFixed(1)} °C 다릅니다.`); }
  return { ...base, level, t_sat_c: tSat, current: { pinch_c: pinch, approach_c: approach }, message: notes.length ? notes.join(' ') : '설계 범위 안입니다.' };
}

// 핀치·어프로치 섹션 3개 + 핵심 성능 지표 KPI 10개 (팀 2 탭 3)
export function keyIndicators(inp, D) {
  const r = calculate(inp, D), N = normalize(inp, D), K = D.constants;
  const sections = Object.keys(D.pinch.design).map(l => pinchSection(l, N.sections[l], D)), hp = sections.find(s => s.label === 'HP');
  const e = r.efficiency, dropPp = e.now === null ? null : (e.design - e.now) * 100, E = K.efficiency_drop_pp;
  const effLevel = dropPp === null ? 'no_data' : dropPp >= E.danger ? 'danger' : dropPp >= E.caution ? 'caution' : 'normal';
  const overall = worst([...sections.map(s => s.level), effLevel, r.overall_level].filter(l => l !== 'no_data'));
  const card = k => hp.current ? { value: hp.current[k], vs_design: hp.current[k] - hp.design[k], level: hp.level } : { value: null, vs_design: null, level: 'no_data' };
  const dm = r.methods.rows.find(x => x.id === r.default_method.id);
  return {
    sections,
    kpi: {
      overall: { level: overall, text: overall === 'normal' ? '설계 범위 안에서 운전 중' : overall === 'caution' ? '설계 범위를 벗어난 지표가 있습니다' : '즉시 점검이 필요한 지표가 있습니다' },
      hp_pinch_c: card('pinch_c'), hp_approach_c: card('approach_c'),
      hp_steam_tph: { value: N.hp_steam_tph },
      heat_recovery_eff: { value: e.now, vs_design_pp: dropPp === null ? null : -dropPp, level: effLevel },
      performance_loss_mw: { value: r.loss.total_mw, level: r.overall_level },
      recovery_after_cleaning_mw: { value: r.default_method.recovered_mw, recovery_vs_loss: r.default_method.recovery_vs_loss },
      annual_loss_krw: { value: r.annual_loss_krw, level: r.overall_level },
      cleaning_cost_krw: { value: dm?.available ? dm.total_investment_krw : null, method: r.default_method.name },
      payback_months: { value: dm?.available ? dm.payback_months : null },   // null → 「산출 불가」
    },
  };
}

// ───────── 표시 ─────────
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
// 금액: 1억 이상 「1.86억 원」, 그 아래 「3204만 원」
export function formatKrw(krw) {
  if (krw === null || krw === undefined) return '—';
  const sign = krw < 0 ? '-' : '', a = Math.abs(krw);
  return a >= 1e8 ? `${sign}${round(a / 1e8, 2)}억 원` : `${sign}${Math.round(a / 1e4)}만 원`;
}
