# 데이터 요청 체크리스트 로직 — 두 팀 공통 (common-0.2), Python 판. checklist.js 와 같은 결과(test_checklist.py 로 확인).
# 진행 상태(progress): { 항목 ID: { supply, verify, reviewed, value, note } } — 항목 데이터 파일과 따로 저장한다.
#   supply : 'not_entered'(실측 미입력·대기, 기본) | 'requested'(요청 필요·요청함) | 'received'(수령 완료) | 'verify_needed'(검증 필요) | 'na'(해당 없음)
#   verify : 'unverified'(미검증, 기본) | 'in_progress'(검증 진행 중) | 'verified'(검증 완료) | 'failed'(검증 실패)
#   reviewed: 검토 체크, value: 측정값, note: 메모
# 화면 글자는 팀마다 달라도 되지만, 저장하는 값은 위의 영문 키다.

import copy
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / 'data'


def load_checklist_data(path=None):
    """data/checklist.json 을 읽는다 (= JS 의 C)."""
    return json.loads(Path(path or DATA_DIR / 'checklist.json').read_text(encoding='utf-8'))


def _p(prog, item_id):
    return (prog or {}).get(item_id) or {}


def supply_of(prog, item_id):
    return _p(prog, item_id).get('supply') or 'not_entered'


def verify_of(prog, item_id):
    return _p(prog, item_id).get('verify') or 'unverified'


def is_na(prog, item_id):
    return supply_of(prog, item_id) == 'na'


def is_received(prog, item_id):
    """「수령」= 데이터가 들어온 상태: 수령 완료 + 검증 필요 (임시 기준)"""
    return supply_of(prog, item_id) in ('received', 'verify_needed')


def is_satisfied(prog, item_id):
    """「필수 충족」= 수령했고 검증 실패가 아닌 상태 (임시 기준)"""
    return is_received(prog, item_id) and verify_of(prog, item_id) != 'failed'


def _rate(items, prog, ok):
    """비율: 해당 없음은 분모에서 뺀다. 「0% (0/49)」"""
    counted = [i for i in items if not is_na(prog, i['id'])]
    done = sum(1 for i in counted if ok(i))
    return {'done': done, 'total': len(counted), 'percent': int(math.floor(done / len(counted) * 100 + 0.5)) if counted else 0}


PROGRESS_KEYS = ('supply', 'verify', 'reviewed', 'value', 'note')


def validate_progress(C, prog):
    """진행 상태 검사: 모르는 항목 ID, 모르는 상태 값(화면 글자를 그대로 넣은 경우 포함), 모르는 필드"""
    errors, warnings = [], []
    ids = {i['id'] for i in C['items']}
    for item_id, p in (prog or {}).items():
        if item_id not in ids:
            errors.append(f'항목 ID {item_id} 는 체크리스트에 없습니다 (A-01 ~ E-18 형식).')
            continue
        p = p or {}
        for k, states in (('supply', C['supply_states']), ('verify', C['verify_states'])):
            if k not in p:
                continue
            v = p[k]
            if isinstance(v, str) and v in states:
                continue
            key = next((s for s, label in states.items() if label == v), None)
            hint = f'화면 글자 대신 "{key}" 를 넣어 주세요.' if key else f"가능한 값: {', '.join(states)}"
            errors.append(f'{item_id}.{k} 값 {json.dumps(v, ensure_ascii=False)} 를 모릅니다. {hint}')
        for k in p:
            if k not in PROGRESS_KEYS:
                warnings.append(f'{item_id}.{k} 는 키트가 쓰지 않는 이름입니다.')
    return {'ok': not errors, 'errors': errors, 'warnings': warnings}


def kpis(C, prog):
    """상단 카드: 전체 수령률 · 검토 진행률 · 검증 완료율 · 필수 충족률"""
    return {
        'received': _rate(C['items'], prog, lambda i: is_received(prog, i['id'])),
        'reviewed': _rate(C['items'], prog, lambda i: bool(_p(prog, i['id']).get('reviewed'))),
        'verified': _rate(C['items'], prog, lambda i: verify_of(prog, i['id']) == 'verified'),
        'required': _rate([i for i in C['items'] if i['required']], prog, lambda i: is_satisfied(prog, i['id'])),
    }


def by_category(C, prog):
    """카테고리별 수령률: 「A. 가스터빈/운전 0/6」"""
    return [{'id': c['id'], 'name': c['name'], **_rate([i for i in C['items'] if i['category'] == c['id']], prog, lambda i: is_received(prog, i['id']))}
            for c in C['categories']]


def summary(C, prog):
    """한 번에: 「전체 진행률 0% (0/49)」「필수 0/16」 + 카테고리별"""
    k = kpis(C, prog)
    return {'all': k['received'], 'required': k['required'], 'by_category': by_category(C, prog)}


def distribution(C, prog):
    """수급 상태 분포(도넛), 검증 상태, 미수령 필수 항목 ID"""
    def count(states, of):
        return {s: sum(1 for i in C['items'] if of(prog, i['id']) == s) for s in states}
    return {
        'total': len(C['items']),
        'supply': count(C['supply_states'], supply_of),
        'verify': count(C['verify_states'], verify_of),
        'missing_required': [i['id'] for i in C['items'] if i['required'] and not is_received(prog, i['id']) and not is_na(prog, i['id'])],
    }


def matrix(C, prog):
    """범주 × 수급 상태 표 (칸을 누르면 filter_items(category=.., supply=..))"""
    return [{'id': c['id'], 'name': c['name'],
             'counts': {s: sum(1 for i in C['items'] if i['category'] == c['id'] and supply_of(prog, i['id']) == s) for s in C['supply_states']}}
            for c in C['categories']]


def filter_items(C, prog, query='', category='all', supply='all', required_only=False, incomplete_only=False):
    """목록 필터: 검색(ID·항목명·이유), 카테고리, 수급 상태, 필수만, 미완료만(수령·해당 없음 제외)"""
    q = query.strip().lower()
    return [i for i in C['items']
            if (not q or q in f"{i['id']} {i['name']} {i['reason']}".lower())
            and (category == 'all' or i['category'] == category)
            and (supply == 'all' or supply_of(prog, i['id']) == supply)
            and (not required_only or i['required'])
            and (not incomplete_only or not (is_received(prog, i['id']) or is_na(prog, i['id'])))]


def priority_label(C, item, style='level'):
    """배지 글자. style 'level'(필수 + 높음/중간/낮음) 또는 'simple'(필수/권장/선택)"""
    if style == 'simple':
        return '필수' if item['required'] else '선택' if item['priority'] == 'low' else '권장'
    return f"{'필수 · ' if item['required'] else ''}{C['priorities'][item['priority']]}"


def detail_line(item):
    """항목 아래 작은 줄: "초과 배압과 출력 손실 계산 · 단위 mmH₂O 또는 mbar" """
    return ' · '.join(x for x in (item['reason'], item['unit'] and f"단위 {item['unit']}") if x)


def measure_cell(item, prog):
    """「측정값」 칸: 값이 있으면 값, 문서 항목은 「문서」, 나머지는 「—」"""
    v = _p(prog, item['id']).get('value')
    if v is not None:
        return v
    return '문서' if item['kind'] == 'document' else '—'


def email_draft(C, prog, ids=None, plant='', due=''):
    """요청 메일 문구. ids 를 주면 그 항목만(「요청 메일 초안 (n)」), 안 주면 아직 받지 않은 항목 전부(「이메일 텍스트 복사」).
    메일을 보내지 않고 문구만 만든다(복사용)."""
    pick = [i for i in C['items'] if (i['id'] in ids if ids is not None else not (is_received(prog, i['id']) or is_na(prog, i['id'])))]
    head = (plant + ' ' if plant else '') + 'HRSG 성능 진단을 위해 아래 데이터를 요청드립니다.'
    if due:
        head += f' 가능하시면 {due}까지 회신 부탁드립니다.'
    lines = [head, '']
    for c in C['categories']:
        rows = [i for i in pick if i['category'] == c['id']]
        if not rows:
            continue
        lines.append(f"[{c['name']}]")
        for i in rows:
            unit = f" ({i['unit']})" if i['unit'] else ''
            req = ' [필수]' if i['required'] else ''
            lines.append(f"- {i['id']} {i['name']}{unit} — {i['reason']}{req}")
        lines.append('')
    lines.append('필수 항목을 먼저 보내 주시면 진단을 시작할 수 있습니다. 감사합니다.')
    return '\n'.join(lines)


HEADERS = ['ID', '카테고리', '항목', '단위', '이유', '필수', '우선순위', '측정값', '수급 상태', '검증 상태', '검토', '메모']


def export_rows(C, prog, template=False):
    """「Excel 내보내기」·「표준 양식」용 행 (xlsx 저장은 openpyxl·pandas 등으로). 표준 양식은 상태·값 칸을 비운다."""
    cat = {c['id']: c['name'] for c in C['categories']}
    rows = []
    for i in C['items']:
        p = {} if template else _p(prog, i['id'])
        rows.append([i['id'], cat[i['category']], i['name'], i['unit'], i['reason'], '필수' if i['required'] else '', C['priorities'][i['priority']],
                     p.get('value') if p.get('value') is not None else '',
                     '' if template else C['supply_states'][supply_of(prog, i['id'])],
                     '' if template else C['verify_states'][verify_of(prog, i['id'])],
                     'Y' if p.get('reviewed') else '', p.get('note') if p.get('note') is not None else ''])
    return rows


def import_reply(C, prog, rows):
    """「회신 Excel 가져오기」: ID 로 항목을 찾아 측정값을 넣고 수급 상태를 「검증 필요」로. 모르는 ID 는 unknown 으로.
    원래 progress 는 바꾸지 않고 새 dict 를 돌려준다."""
    ids = {i['id'] for i in C['items']}
    col = HEADERS.index('측정값')
    nxt, unknown, updated = copy.deepcopy(prog or {}), [], 0
    for r in rows:
        item_id = str(r[0] if r and r[0] is not None else '').strip()
        v = r[col] if len(r) > col else None
        if not item_id or item_id == 'ID':
            continue
        if item_id not in ids:
            unknown.append(item_id)
            continue
        if v is None or str(v).strip() == '':
            continue
        prev = nxt.get(item_id) or {}
        nxt[item_id] = {**prev, 'value': str(v).strip(), 'supply': 'verify_needed', 'verify': prev.get('verify', 'unverified')}
        updated += 1
    return {'progress': nxt, 'updated': updated, 'unknown': unknown}


def reset_progress():
    """「초기화」: 모든 항목을 처음 상태로"""
    return {}
