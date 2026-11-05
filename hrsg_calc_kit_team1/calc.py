# HRSG 성능·경제성 계산기 로직 — 두 팀 공통 (common-0.2), Python 판. calc.js 와 같은 식·같은 결과(test_calc.py 로 확인).
# 화면과 무관한 순수 함수. 값은 data/calculator.json(DEMO 값)에서 받는다. 표준 라이브러리만 쓴다.
#
# 입력 한 벌(inp) = default_inputs(D) 의 모양(dict). 압력은 키 이름 끝의 단위로 받는다(_mbar · _mmh2o · _kpa · _inh2o 중 하나).
#   equipment: { gt_class, load_pct, gt_bp_<단위>, hrsg_dp_<단위>, stack_c,                 ← 필수
#                rated_gt_mw, rated_st_mw, base_gt_bp_<단위>, base_hrsg_dp_<단위>, base_stack_c, ← 선택: 없으면 GT 등급의 값
#                gt_exhaust_c, exhaust_flow_kgs, ambient_c }                                  ← 선택: 없으면 열회수 효율은 None
#   economics: { price_krw_per_kwh 또는 price_krw_per_mwh, monthly_hours, annual_hours, target_recovery_mw }
#   methods:   [{ id, name, cost_krw, outage_days, indirect_krw, recovery_ratio, recovery_mw }]
#   sections:  { HP: { drum_barg, evap_outlet_gas_c, econ_outlet_water_c, pinch_design_c?, approach_design_c? } | None, IP, LP }
#   hp_steam_tph
# 결과의 압력은 mbar 와 mmH₂O 를 함께 준다({'mbar': .., 'mmh2o': ..}).

import copy
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / 'data'


def load_calculator_data(path=None):
    """data/calculator.json 을 읽는다 (= JS 의 D)."""
    return json.loads(Path(path or DATA_DIR / 'calculator.json').read_text(encoding='utf-8'))


def _clamp01(x):
    return min(1.0, max(0.0, x))


def _is_num(v):
    if v is None or v == '' or isinstance(v, bool):
        return False
    try:
        return math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _num(v):
    return float(v) if _is_num(v) else None


def _js(v):
    """메시지 안의 값 표시 (JSON.stringify 와 같게)."""
    return json.dumps(v, ensure_ascii=False)


def _round_half_up(x, d=0):
    m = 10 ** d
    return math.floor(x * m + 0.5) / m


def _num_str(x):
    """JS 의 숫자 → 문자열과 같게 (2.0 → '2', 2.1 → '2.1')."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


_RANK = {'normal': 0, 'caution': 1, 'danger': 2}


def worst(levels):
    w = 'normal'
    for lv in levels:
        if _RANK[lv] > _RANK[w]:
            w = lv
    return w


# 압력 단위: 1 mmH₂O = 0.0980665 mbar, 1 kPa = 10 mbar, 1 inH₂O = 2.49089 mbar
PRESSURE_UNITS = {'mbar': 1, 'mmh2o': 0.0980665, 'kpa': 10, 'inh2o': 2.49089}


def to_mbar(v, unit):
    return v * PRESSURE_UNITS[unit]


def from_mbar(mbar, unit):
    return mbar / PRESSURE_UNITS[unit]


def _both(mbar):
    return {'mbar': mbar, 'mmh2o': from_mbar(mbar, 'mmh2o')}


def _pressure_keys(obj, base):
    """gt_bp_mmh2o 처럼 단위가 붙은 압력 키를 찾는다 → [(unit, value)]"""
    obj = obj or {}
    return [(u, obj[f'{base}_{u}']) for u in PRESSURE_UNITS if f'{base}_{u}' in obj]


def default_inputs(D, overrides=None):
    """「기본값」: 예시 운전 상태(default_case). 압력은 mbar 키로 채운다."""
    overrides = overrides or {}
    c = D['default_case']
    cls = next(g for g in D['gt_classes'] if g['id'] == overrides.get('gt_class', c['gt_class']))
    sections = {}
    for label in D['pinch']['design']:
        if label not in D['pinch']['default_data_sections']:
            sections[label] = None
            continue
        t = saturation_temp_c_from_barg(D['pinch']['default_drum_barg'][label])
        d = D['pinch']['design'][label]
        sections[label] = {'drum_barg': D['pinch']['default_drum_barg'][label],
                           'evap_outlet_gas_c': float(f"{t + d['pinch_c']:.1f}"),
                           'econ_outlet_water_c': float(f"{t - d['approach_c']:.1f}")}
    return copy.deepcopy({
        'equipment': {'gt_class': cls['id'], **cls['operation'], 'gt_bp_mbar': c['gt_bp_mbar'], 'hrsg_dp_mbar': c['hrsg_dp_mbar'], 'stack_c': c['stack_c']},
        'economics': D['economics'], 'methods': D['methods'], 'sections': sections, 'hp_steam_tph': cls['hp_steam_tph'],
    })


def design_inputs(D, class_id=None):
    """설계 상태(손실 0): GT 등급의 설계값으로 채운 입력 (「초기화」 버튼)"""
    class_id = class_id or D['default_case']['gt_class']
    inp = default_inputs(D, {'gt_class': class_id})
    I = next(g for g in D['gt_classes'] if g['id'] == class_id)['indicators']
    inp['equipment'].update({'gt_bp_mbar': I['gt_bp_mbar']['design'], 'hrsg_dp_mbar': I['hrsg_dp_mbar']['design'], 'stack_c': I['stack_c']['design']})
    return inp


# ───────── 입력 검사 ─────────
EQUIP_NUM = {'load_pct': ('운전 부하율', '%', True), 'stack_c': ('스택 온도', '°C', True), 'rated_gt_mw': ('GT 정격 출력', 'MW', False),
             'rated_st_mw': ('ST 정격 출력', 'MW', False), 'base_stack_c': ('기준(설계) 스택 온도', '°C', False),
             'gt_exhaust_c': ('GT 배기 온도', '°C', False), 'exhaust_flow_kgs': ('배기가스 유량', 'kg/s', False), 'ambient_c': ('외기 온도', '°C', False)}
PRESSURES = {'gt_bp': ('GT 배압(현재 배압)', True), 'hrsg_dp': ('HRSG 가스측 차압', True),
             'base_gt_bp': ('기준(설계) GT 배압', False), 'base_hrsg_dp': ('기준(설계) HRSG 차압', False)}
ECON_NUM = {'monthly_hours': ('월간 가동시간', 'h', False), 'annual_hours': ('연간 운전 시간', 'h', False), 'target_recovery_mw': ('목표 회수 출력', 'MW', False)}
METHOD_NUM = {'cost_krw': ('세정 비용', '원', False), 'outage_days': ('정지일수', '일', False), 'indirect_krw': ('간접 비용', '원', False),
              'recovery_ratio': ('회수율', '0~1', False), 'recovery_mw': ('회수 출력', 'MW', False)}
SECTION_NUM = {'drum_barg': ('드럼 압력', 'barg', False), 'evap_outlet_gas_c': ('증발기 출구 가스 온도', '°C', False),
               'econ_outlet_water_c': ('절탄기 출구 급수 온도', '°C', False), 'pinch_design_c': ('핀치 설계값', '°C', False),
               'approach_design_c': ('어프로치 설계값', '°C', False)}


def validate_inputs(inp, D):
    """내 화면 상태를 어댑터로 바꾼 결과가 키트 입력 모양과 맞는지 확인한다.
    errors: 계산할 수 없음(빠진 값, 숫자가 아닌 값, 모르는 GT 등급) → calculate() 가 오류를 낸다.
    warnings: 계산은 되지만 이름이 틀렸거나 단위가 다를 수 있음."""
    errors, warnings = [], []
    inp = inp if isinstance(inp, dict) else {}

    def check_nums(obj, spec, path):
        for k, (label, unit, req) in spec.items():
            v = (obj or {}).get(k)
            where = f'{path}.{k} ({label}, {unit})'
            if v is None or v == '':
                if req:
                    errors.append(f'{where} 값이 없습니다.')
                continue
            if not _is_num(v):
                errors.append(f'{where} 숫자가 아닙니다: {_js(v)}')

    def unknown(obj, known, path):
        for k in (obj or {}):
            if not known(k) and not k.startswith('_'):
                warnings.append(f'{path}.{k} 는 키트가 쓰지 않는 이름입니다. 오타이거나 다른 이름으로 바꿔야 하는지 확인해 주세요.')

    eq = inp.get('equipment')
    if not isinstance(eq, dict):
        errors.append('equipment 묶음이 없습니다.')
        eq = None
    else:
        if not any(g['id'] == eq.get('gt_class') for g in D['gt_classes']):
            errors.append(f"equipment.gt_class (가스터빈 등급) 값 {_js(eq.get('gt_class'))} 를 모릅니다. 가능한 값: {', '.join(g['id'] for g in D['gt_classes'])}")
        check_nums(eq, EQUIP_NUM, 'equipment')
        for base, (label, req) in PRESSURES.items():
            found = _pressure_keys(eq, base)
            units = ' / '.join(f'{base}_{u}' for u in PRESSURE_UNITS)
            if not found:
                if req:
                    errors.append(f'equipment.{base}_<단위> ({label}) 값이 없습니다. {units} 중 하나로 넣어 주세요.')
                continue
            if len(found) > 1:
                errors.append(f"equipment.{base} 가 두 단위로 들어왔습니다({', '.join(base + '_' + u for u, _ in found)}). 하나만 넣어 주세요.")
            for u, v in found:
                if not _is_num(v):
                    errors.append(f'equipment.{base}_{u} ({label}) 숫자가 아닙니다: {_js(v)}')

        def known_eq(k):
            return k == 'gt_class' or k in EQUIP_NUM or any(k == f'{b}_{u}' for b in PRESSURES for u in PRESSURE_UNITS)
        unknown(eq, known_eq, 'equipment')

    ec = inp.get('economics')
    if not isinstance(ec, dict):
        errors.append('economics 묶음이 없습니다.')
        ec = None
    else:
        prices = [k for k in ('price_krw_per_kwh', 'price_krw_per_mwh') if _is_num(ec.get(k))]
        if not prices:
            errors.append('economics.price_krw_per_kwh (SMP, 원/kWh) 또는 price_krw_per_mwh (전력 단가, 원/MWh) 중 하나가 필요합니다.')
        if len(prices) == 2:
            errors.append('전력 단가가 원/kWh 와 원/MWh 로 두 번 들어왔습니다. 하나만 넣어 주세요.')
        check_nums(ec, ECON_NUM, 'economics')
        if not _is_num(ec.get('monthly_hours')) and not _is_num(ec.get('annual_hours')):
            errors.append('economics.monthly_hours (월간 가동시간) 또는 annual_hours (연간 운전 시간) 중 하나가 필요합니다.')
        unknown(ec, lambda k: k in ECON_NUM or k in ('price_krw_per_kwh', 'price_krw_per_mwh'), 'economics')

    methods = inp.get('methods')
    if not isinstance(methods, list):
        errors.append('methods 는 세정 공법 배열이어야 합니다.')
    else:
        for i, m in enumerate(methods):
            m = m or {}
            if not m.get('id') or not m.get('name'):
                errors.append(f'methods[{i}] 에 id 와 name 이 필요합니다.')
            check_nums(m, METHOD_NUM, f'methods[{i}]')
            unknown(m, lambda k: k in ('id', 'name') or k in METHOD_NUM, f'methods[{i}]')
            if _is_num(m.get('recovery_ratio')) and float(m['recovery_ratio']) > 1:
                warnings.append(f'methods[{i}].recovery_ratio 가 1 보다 큽니다. % 가 아니라 0~1 비율로 넣어 주세요 (예: 0.45).')

    if inp.get('sections') is not None:
        for label, s in inp['sections'].items():
            if label not in D['pinch']['design']:
                warnings.append(f'sections.{label} 는 키트가 쓰지 않는 섹션입니다 (HP, IP, LP).')
                continue
            if s is None:
                continue
            check_nums(s, SECTION_NUM, f'sections.{label}')
            unknown(s, lambda k: k in SECTION_NUM, f'sections.{label}')
    unknown(inp, lambda k: k in ('equipment', 'economics', 'methods', 'sections', 'hp_steam_tph'), 'inp')

    # 단위를 잘못 넣었을 때 자주 나오는 값 (경고만)
    def hint(cond, msg):
        if cond:
            warnings.append(msg)
    if eq is not None:
        lp = eq.get('load_pct')
        hint(_is_num(lp) and 0 < float(lp) <= 1.5, 'equipment.load_pct: 부하율이 0~1 비율로 들어온 것 같습니다. % 로 넣어 주세요 (예: 100).')
        for base in ('gt_bp', 'hrsg_dp', 'base_gt_bp', 'base_hrsg_dp'):
            for u, v in _pressure_keys(eq, base):
                if _is_num(v):
                    mbar = to_mbar(float(v), u)
                    hint(mbar > 150, f'equipment.{base}_{u}: {mbar:.0f} mbar 는 너무 큽니다. 다른 단위 값을 _{u} 키에 넣은 것 아닌지 확인해 주세요.')
                    hint(0 < mbar < 3, f'equipment.{base}_{u}: {mbar:.2f} mbar 는 너무 작습니다. 다른 단위 값을 _{u} 키에 넣은 것 아닌지 확인해 주세요.')
    if ec is not None:
        g = ec.get
        hint(_is_num(g('price_krw_per_kwh')) and float(g('price_krw_per_kwh')) > 1000, 'economics.price_krw_per_kwh 가 너무 큽니다. 원/MWh 값이면 price_krw_per_mwh 에 넣어 주세요.')
        hint(_is_num(g('price_krw_per_mwh')) and float(g('price_krw_per_mwh')) < 1000, 'economics.price_krw_per_mwh 가 너무 작습니다. 원/kWh 값이면 price_krw_per_kwh 에 넣어 주세요.')
        hint(_is_num(g('monthly_hours')) and float(g('monthly_hours')) > 744, 'economics.monthly_hours 가 한 달(744 h)보다 깁니다. 연간 시간이면 annual_hours 에 넣어 주세요.')
        hint(_is_num(g('annual_hours')) and float(g('annual_hours')) <= 744, 'economics.annual_hours 가 한 달 이하입니다. 월간 시간이면 monthly_hours 에 넣어 주세요.')
    return {'ok': not errors, 'errors': errors, 'warnings': warnings}


# ───────── 내부 표준형 (mbar, 원/MWh, 숫자) ─────────
def normalize(inp, D):
    eq, ec = inp['equipment'], inp['economics']
    cls = next(g for g in D['gt_classes'] if g['id'] == eq['gt_class'])

    def p(base):
        for u, v in _pressure_keys(eq, base):
            if _is_num(v):
                return to_mbar(float(v), u)
        return None
    ind = copy.deepcopy(cls['indicators'])

    def rebase(k, v):
        if v is None:
            return
        d = v - ind[k]['design']
        for t in ('design', 'caution', 'danger', 'min', 'max'):
            ind[k][t] += d
    rebase('gt_bp_mbar', p('base_gt_bp'))
    rebase('hrsg_dp_mbar', p('base_hrsg_dp'))
    rebase('stack_c', _num(eq.get('base_stack_c')))
    monthly, annual = _num(ec.get('monthly_hours')), _num(ec.get('annual_hours'))
    rated_gt, rated_st = _num(eq.get('rated_gt_mw')), _num(eq.get('rated_st_mw'))
    return {
        'cls': cls, 'ind': ind,
        'rated_gt_mw': rated_gt if rated_gt is not None else cls['rated_gt_mw'],
        'rated_st_mw': rated_st if rated_st is not None else cls['rated_st_mw'],
        'load': _num(eq.get('load_pct')) / 100, 'gt_bp_mbar': p('gt_bp'), 'hrsg_dp_mbar': p('hrsg_dp'), 'stack_c': _num(eq.get('stack_c')),
        'gt_exhaust_c': _num(eq.get('gt_exhaust_c')), 'ambient_c': _num(eq.get('ambient_c')),
        'price_krw_per_mwh': float(ec['price_krw_per_mwh']) if _is_num(ec.get('price_krw_per_mwh')) else _num(ec.get('price_krw_per_kwh')) * 1000,
        'monthly_hours': monthly if monthly is not None else annual / 12,
        'annual_hours': annual if annual is not None else monthly * 12,
        'target_recovery_mw': _num(ec.get('target_recovery_mw')),
        'methods': [{'id': m.get('id'), 'name': m.get('name'), **{k: _num(m.get(k)) for k in METHOD_NUM}} for m in inp['methods']],
        'sections': inp.get('sections') or {}, 'hp_steam_tph': _num(inp.get('hp_steam_tph')),
    }


# ───────── 손실·금액 ─────────
def indicator_level(ind, v):
    return 'danger' if v >= ind['danger'] else 'caution' if v >= ind['caution'] else 'normal'


def _excess_ratio(ind, v):
    return _clamp01((v - ind['design']) / (ind['danger'] - ind['design']))


def _values(N):
    return {'gt_bp_mbar': N['gt_bp_mbar'], 'hrsg_dp_mbar': N['hrsg_dp_mbar'], 'stack_c': N['stack_c']}


def _excess_bp(N, v):
    """초과 압력 = 두 압력(GT 배압, HRSG 차압) 중 설계 초과분이 더 큰 것 (이중 계산 방지)"""
    return max(0, v['hrsg_dp_mbar'] - N['ind']['hrsg_dp_mbar']['design'], v['gt_bp_mbar'] - N['ind']['gt_bp_mbar']['design'])


def _power_loss(N, K, v=None):
    """출력 손실 [MW]: GT = GT 정격 × 0.08 %/mbar × 초과 압력 × 부하, ST = ST 정격 × 0.12 %/°C × 스택 초과 × 부하"""
    v = v or _values(N)
    d_stack = max(0, v['stack_c'] - N['ind']['stack_c']['design'])
    gt = N['rated_gt_mw'] * K['gt_loss_pct_per_mbar'] / 100 * _excess_bp(N, v) * N['load']
    st = N['rated_st_mw'] * K['st_loss_pct_per_c'] / 100 * d_stack * N['load']
    return {'gt_mw': gt, 'st_mw': st, 'total_mw': gt + st}


def _after_cleaning(N, r, v=None):
    """세정 후 값: 세 지표 모두 설계 초과분이 회수율만큼 줄어든다"""
    v = v or _values(N)
    return {k: x - r * max(0, x - N['ind'][k]['design']) for k, x in v.items()}


def _monthly_krw(N, mw):
    return mw * N['monthly_hours'] * N['price_krw_per_mwh']


def _annual_krw(N, mw):
    return mw * N['annual_hours'] * N['price_krw_per_mwh']


def _eff(N, stack):
    """열회수 효율 = (배기온도 − 스택온도) / (배기온도 − 외기온도). 배기·외기 온도가 없으면 None"""
    if N['gt_exhaust_c'] is None or N['ambient_c'] is None:
        return None
    return (N['gt_exhaust_c'] - stack) / (N['gt_exhaust_c'] - N['ambient_c'])


def _method_row(N, K, m, loss_now):
    """공법 하나. 비용·정지일수·간접 비용 중 비어 있으면 「산출 불가 — 입력 필요: …」
    회수 출력: recovery_mw 가 있으면 그 값 → 없으면 recovery_ratio 로 계산 → 둘 다 없으면 목표 회수 출력"""
    missing = [label for k, label in (('cost_krw', '세정 비용'), ('outage_days', '정지일수'), ('indirect_krw', '간접 비용')) if m[k] is None]
    if missing:
        return {'id': m['id'], 'name': m['name'], 'available': False, 'missing': missing, 'message': f"산출 불가 — 입력 필요: {', '.join(missing)}"}
    if m['recovery_mw'] is not None:
        recovered, basis = m['recovery_mw'], 'mw'
    elif m['recovery_ratio'] is not None:
        recovered, basis = loss_now - _power_loss(N, K, _after_cleaning(N, m['recovery_ratio']))['total_mw'], 'ratio'
    elif N['target_recovery_mw'] is not None:
        recovered, basis = N['target_recovery_mw'], 'target'
    else:
        return {'id': m['id'], 'name': m['name'], 'available': False, 'missing': ['회수 출력'], 'message': '산출 불가 — 입력 필요: 회수 출력(또는 회수율·목표 회수 출력)'}
    # 정지 손실 = (GT + ST 정격) × 부하 × 정지일수 × 24 h × 전력 단가 × 마진율 (DEMO: 정지 중 잃는 마진만 비용으로 봄)
    outage = (N['rated_gt_mw'] + N['rated_st_mw']) * N['load'] * m['outage_days'] * 24 * N['price_krw_per_mwh'] * K['outage_margin_ratio']
    total = m['cost_krw'] + m['indirect_krw'] + outage
    monthly, annual = _monthly_krw(N, recovered), _annual_krw(N, recovered)
    payback = total / monthly if monthly > 0 else None   # None → 「산출 불가」
    return {
        'id': m['id'], 'name': m['name'], 'available': True,
        'cost_krw': m['cost_krw'], 'outage_days': m['outage_days'], 'indirect_krw': m['indirect_krw'], 'recovery_ratio': m['recovery_ratio'],
        'recovered_mw': recovered, 'recovery_basis': basis,   # 'mw' | 'ratio' | 'target'
        'monthly_benefit_krw': monthly, 'annual_benefit_krw': annual, 'outage_loss_krw': outage, 'total_investment_krw': total,
        'payback_months': payback, 'breakeven_days': None if payback is None else payback * N['monthly_hours'] / 24,
        'first_month_net_krw': monthly - total, 'annual_net_krw': annual - total,
    }


def compare_methods(inp, D, sort_by='none'):
    """세정 공법별 비교. sort_by: 'payback'(회수기간 짧은 순) | 'total'(총투자 적은 순) | 'net'(첫 달 순편익 큰 순) | 'annual_net'(연간 순편익 큰 순) | 'none'"""
    N, K = normalize(inp, D), D['constants']
    loss_now = _power_loss(N, K)['total_mw']
    rows = [_method_row(N, K, m, loss_now) for m in N['methods']]
    ok = [r for r in rows if r['available']]
    keys = {'payback': lambda r: r['payback_months'] if r['payback_months'] is not None else math.inf,
            'total': lambda r: r['total_investment_krw'], 'net': lambda r: -r['first_month_net_krw'], 'annual_net': lambda r: -r['annual_net_krw']}
    key = keys.get(sort_by)
    ordered = sorted(ok, key=key) + [r for r in rows if not r['available']] if key else rows
    fastest = sorted([r for r in ok if r['payback_months'] is not None], key=lambda r: r['payback_months'])
    max_net = sorted(ok, key=lambda r: -r['annual_net_krw'])
    return {
        'rows': ordered,
        'best_payback_id': fastest[0]['id'] if fastest else None,                                          # 「회수기간이 가장 짧은 공법 (추천 아님)」
        'max_net_benefit_id': max_net[0]['id'] if max_net and max_net[0]['annual_net_krw'] > 0 else None,  # 「순편익 최대」(모두 0 이하면 None)
    }


def calculate(inp, D):
    """「계산 실행」: 화면에 필요한 결과 전부. 입력이 키트 형식과 다르면 계산하지 않고 오류를 낸다."""
    check = validate_inputs(inp, D)
    if not check['ok']:
        raise TypeError('계산기 입력이 키트 형식과 맞지 않습니다.\n- ' + '\n- '.join(check['errors']))
    N, K = normalize(inp, D), D['constants']
    v = _values(N)
    loss = _power_loss(N, K)
    d_bp = _excess_bp(N, v)
    d_stack = max(0, N['stack_c'] - N['ind']['stack_c']['design'])
    indicators = {k: {**ind, 'value': v[k], 'level': indicator_level(ind, v[k])} for k, ind in N['ind'].items()}
    overall = worst([i['level'] for i in indicators.values()])

    # 기본 공법(constants.default_method)으로 세정했을 때 (팀 2 탭 1 「세정 시 회수효과」)
    dm = next((m for m in N['methods'] if m['id'] == K['default_method']), N['methods'][0] if N['methods'] else None)
    after = _after_cleaning(N, (dm or {}).get('recovery_ratio') or 0)
    loss_after = _power_loss(N, K, after)
    recovered_default = loss['total_mw'] - loss_after['total_mw']

    # 세정 필요도(오염) 지수 0~100 = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도) 의 초과 비율
    W = K['index_weights']

    def x(k):
        return _excess_ratio(N['ind'][k], v[k])
    pressure_part = 100 * (W['hrsg_dp_mbar'] * x('hrsg_dp_mbar') + W['gt_bp_mbar'] * x('gt_bp_mbar'))
    temp_part = 100 * W['stack_c'] * x('stack_c')

    cmp = compare_methods(inp, D)
    best = next((r for r in cmp['rows'] if r['id'] == cmp['best_payback_id']), None)
    warnings = [f"{r['name']}의 회수 출력({_num_str(_round_half_up(r['recovered_mw'], 2))} MW)이 현재 출력 손실({_num_str(_round_half_up(loss['total_mw'], 3))} MW)보다 큽니다. "
                '잃은 출력보다 많이 회수한다는 가정이므로 입력을 확인하세요.'
                for r in cmp['rows'] if r['available'] and r['recovery_basis'] != 'ratio' and r['recovered_mw'] > loss['total_mw']]
    gauge_max = max(N['ind']['gt_bp_mbar']['max'] - N['ind']['gt_bp_mbar']['design'], N['ind']['hrsg_dp_mbar']['max'] - N['ind']['hrsg_dp_mbar']['design'])

    def b(key):
        return best[key] if best else None
    return {
        'indicators': indicators, 'overall_level': overall,
        'loss': loss, 'excess_pressure': _both(d_bp), 'excess_stack_c': d_stack,
        'monthly_loss_krw': _monthly_krw(N, loss['total_mw']), 'annual_loss_krw': _annual_krw(N, loss['total_mw']),
        'default_method': {'id': dm['id'] if dm else None, 'name': dm['name'] if dm else None, 'recovered_mw': recovered_default,
                           'monthly_recovery_krw': _monthly_krw(N, recovered_default), 'annual_recovery_krw': _annual_krw(N, recovered_default),
                           'recovery_vs_loss': recovered_default / loss['total_mw'] if loss['total_mw'] > 0 else 0,
                           'values_after': after, 'loss_after': loss_after},
        'efficiency': {'now': _eff(N, N['stack_c']), 'after': _eff(N, after['stack_c']), 'design': _eff(N, N['ind']['stack_c']['design'])},
        'index': {'value': pressure_part + temp_part, 'pressure_part': pressure_part, 'temp_part': temp_part},
        'display_fouling': {'overall': x('hrsg_dp_mbar'), **{s: _clamp01(x('hrsg_dp_mbar') * w) for s, w in K['section_weights'].items()}},
        'gauge': {'value': _both(d_bp), 'max': _both(gauge_max), 'public_ref': [_both(to_mbar(i, 'inh2o')) for i in K['public_ref_inh2o']]},
        'methods': cmp,
        'kpi': {   # 팀 1 KPI 카드 10개 (공법 값은 회수기간이 가장 짧은 공법 기준)
            'current_bp': _both(N['gt_bp_mbar']), 'excess_bp': _both(d_bp), 'power_loss_mw': loss['total_mw'],
            'monthly_loss_krw': _monthly_krw(N, loss['total_mw']),
            'expected_recovery_mw': b('recovered_mw'), 'investment_krw': b('total_investment_krw'), 'method_name': b('name'),
            'monthly_benefit_krw': b('monthly_benefit_krw'), 'first_month_net_krw': b('first_month_net_krw'),
            'payback_months': b('payback_months'), 'breakeven_days': b('breakeven_days'),
        },
        'warnings': warnings, 'input_warnings': check['warnings'],
    }


def efficiency_trend(inp, D):
    """열회수 효율 추이: 설계 효율에서 현재 효율까지 12개월 선형 저하를 가정한 13개 점 + 세정 후"""
    e = calculate(inp, D)['efficiency']
    if e['now'] is None:
        return None
    return {'months': [{'month': m, 'eff': e['design'] + (e['now'] - e['design']) * m / 12} for m in range(13)],
            'after_cleaning': e['after'], 'design': e['design']}


def loss_curve(inp, D, param='hrsg_dp', points=31):
    """압력-손실 곡선: param('hrsg_dp' | 'gt_bp') 하나만 min~max 로 바꾸고 나머지 입력은 그대로"""
    N, K = normalize(inp, D), D['constants']
    key = f'{param}_mbar'
    ind = N['ind'][key]
    out = []
    for i in range(points):
        val = ind['min'] + (ind['max'] - ind['min']) * i / (points - 1)
        vals = {**_values(N), key: val}
        out.append({'value': _both(val), 'excess': _both(max(0, val - ind['design'])), 'loss_mw': _power_loss(N, K, vals)['total_mw']})
    return {'points': out, 'current': _both(N[key]), 'design': _both(ind['design']), 'caution': _both(ind['caution']), 'danger': _both(ind['danger'])}


# ───────── 핀치·어프로치 ─────────
# 포화온도: IAPWS-IF97 Region 4 (공개 공식). 절대압 MPa → °C
_IF97 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7,
         0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3]


def saturation_temp_c(p_mpa):
    if not (611.213e-6 <= p_mpa <= 22.064):
        raise ValueError('압력은 0.000611~22.064 MPa(절대압) 범위여야 합니다.')
    n1, n2, n3, n4, n5, n6, n7, n8, n9, n10 = _IF97
    b = p_mpa ** 0.25
    e = b * b + n3 * b + n6
    f = n1 * b * b + n4 * b + n7
    g = n2 * b * b + n5 * b + n8
    d = 2 * g / (-f - math.sqrt(f * f - 4 * e * g))
    return (n10 + d - math.sqrt((n10 + d) ** 2 - 4 * (n9 + n10 * d))) / 2 - 273.15


def saturation_temp_c_from_barg(barg):
    return saturation_temp_c((barg + 1.01325) / 10)


def pinch_section(label, data, D):
    """섹션 하나(HP/IP/LP). 필요한 값이 없으면 「데이터 필요」(level 'no_data') + 체크리스트 「B. HRSG 열역학/설계」로 연결"""
    K, dd = D['constants'], D['pinch']['design'][label]
    data = data or None
    pd, ad = _num((data or {}).get('pinch_design_c')), _num((data or {}).get('approach_design_c'))
    design = {'pinch_c': pd if pd is not None else dd['pinch_c'], 'approach_c': ad if ad is not None else dd['approach_c']}
    base = {'label': label, 'design': design, 'checklist_category': 'B'}
    if not data or any(not _is_num(data.get(k)) for k in ('drum_barg', 'evap_outlet_gas_c', 'econ_outlet_water_c')):
        return {**base, 'level': 'no_data', 'current': None, 'message': '평가에 필요한 운전 데이터가 없습니다.'}
    t_sat = saturation_temp_c_from_barg(float(data['drum_barg']))
    pinch = float(data['evap_outlet_gas_c']) - t_sat
    approach = t_sat - float(data['econ_outlet_water_c'])
    m = K['pinch_margin_c']
    if pinch < 0:
        raise ValueError(f'{label}: 증발기 출구 가스 온도가 포화온도({t_sat:.1f} °C)보다 낮을 수 없습니다.')
    notes, level = [], 'normal'
    if approach < 0:
        level = 'danger'
        notes.append('절탄기 출구 급수가 포화온도를 넘었습니다 — 스티밍 우려.')
    if pinch > design['pinch_c'] + m:
        level = worst([level, 'caution'])
        notes.append(f"핀치가 설계보다 {pinch - design['pinch_c']:.1f} °C 큽니다 — 열 회수 저하 의심.")
    if approach >= 0 and abs(approach - design['approach_c']) > m:
        level = worst([level, 'caution'])
        notes.append(f"어프로치가 설계와 {approach - design['approach_c']:.1f} °C 다릅니다.")
    return {**base, 'level': level, 't_sat_c': t_sat, 'current': {'pinch_c': pinch, 'approach_c': approach},
            'message': ' '.join(notes) if notes else '설계 범위 안입니다.'}


def key_indicators(inp, D):
    """핀치·어프로치 섹션 3개 + 핵심 성능 지표 KPI 10개 (팀 2 탭 3)"""
    r, N, K = calculate(inp, D), normalize(inp, D), D['constants']
    sections = [pinch_section(l, N['sections'].get(l), D) for l in D['pinch']['design']]
    hp = next(s for s in sections if s['label'] == 'HP')
    e = r['efficiency']
    drop_pp = None if e['now'] is None else (e['design'] - e['now']) * 100
    E = K['efficiency_drop_pp']
    eff_level = 'no_data' if drop_pp is None else 'danger' if drop_pp >= E['danger'] else 'caution' if drop_pp >= E['caution'] else 'normal'
    overall = worst([l for l in [*(s['level'] for s in sections), eff_level, r['overall_level']] if l != 'no_data'])

    def card(k):
        if hp['current']:
            return {'value': hp['current'][k], 'vs_design': hp['current'][k] - hp['design'][k], 'level': hp['level']}
        return {'value': None, 'vs_design': None, 'level': 'no_data'}
    dm = next((x for x in r['methods']['rows'] if x['id'] == r['default_method']['id']), None)
    texts = {'normal': '설계 범위 안에서 운전 중', 'caution': '설계 범위를 벗어난 지표가 있습니다', 'danger': '즉시 점검이 필요한 지표가 있습니다'}
    return {
        'sections': sections,
        'kpi': {
            'overall': {'level': overall, 'text': texts[overall]},
            'hp_pinch_c': card('pinch_c'), 'hp_approach_c': card('approach_c'),
            'hp_steam_tph': {'value': N['hp_steam_tph']},
            'heat_recovery_eff': {'value': e['now'], 'vs_design_pp': None if drop_pp is None else -drop_pp, 'level': eff_level},
            'performance_loss_mw': {'value': r['loss']['total_mw'], 'level': r['overall_level']},
            'recovery_after_cleaning_mw': {'value': r['default_method']['recovered_mw'], 'recovery_vs_loss': r['default_method']['recovery_vs_loss']},
            'annual_loss_krw': {'value': r['annual_loss_krw'], 'level': r['overall_level']},
            'cleaning_cost_krw': {'value': dm['total_investment_krw'] if dm and dm['available'] else None, 'method': r['default_method']['name']},
            'payback_months': {'value': dm['payback_months'] if dm and dm['available'] else None},   # None → 「산출 불가」
        },
    }


# ───────── 표시 ─────────
def format_krw(krw):
    """금액: 1억 이상 「1.86억 원」, 그 아래 「3204만 원」"""
    if krw is None:
        return '—'
    sign, a = ('-' if krw < 0 else ''), abs(krw)
    if a >= 1e8:
        return f'{sign}{_num_str(_round_half_up(a / 1e8, 2))}억 원'
    return f'{sign}{int(_round_half_up(a / 1e4))}만 원'
