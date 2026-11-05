"""체크리스트 Excel: 내보내기 · 표준 양식 · 고객 회신 가져오기(미리보기 → 반영).

[2026-11-05 키트 연결] 열 구성과 행은 키트 checklist.py 의 HEADERS · export_rows() 를, 회신 가져오기는 import_reply() 를
그대로 씁니다 (키트는 행 배열만 다루고 xlsx 읽기·쓰기는 openpyxl 로). 회신은 「ID」로 항목을 찾아 「측정값」을 넣고
수급 상태를 「검증 필요」로 바꿉니다. 반영은 체크리스트 저장 규칙(update_checklist)을 다시 거치므로 숫자형 항목에
숫자가 아닌 값이 있으면 미리보기에서 오류로 알리고 반영하지 않습니다.
"""

import io
from datetime import datetime

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from engine import kit

from . import checklist_registry as reg
from .services import ensure_case_data, update_checklist

HEADERS = kit.checklist.HEADERS
VALUE_COL = HEADERS.index("측정값")


def _book(case=None):
    ensure = case is not None
    if ensure:
        ensure_case_data(case)
    prog = kit.to_kit_progress(case.checklist.all()) if ensure else {}
    wb = Workbook()
    ws = wb.active
    ws.title = "체크리스트"
    ws.append(HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="EA6C1A" if c.column - 1 == VALUE_COL else "1F2937")
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for row in kit.checklist.export_rows(kit.C(), prog, template=not ensure):
        ws.append(row)
    for i, w in enumerate([7, 18, 32, 14, 36, 6, 8, 14, 11, 11, 6, 24], 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w
    ws.freeze_panes = "C2"
    info = wb.create_sheet("안내")
    for line in [
        "HRSG Explorer 데이터 요청 체크리스트 (가상 데이터 데모 — 실제 설비 판단에 사용하지 마세요)",
        f"작성: {datetime.now():%Y-%m-%d %H:%M}" + (f" · 케이스: {case.name}" if case else " · 표준 양식"),
        "",
        "작성 방법",
        "1. 주황색 머리글 '측정값' 열만 채웁니다. ID·항목 등 다른 열은 바꾸지 마세요.",
        "2. 가져오면 측정값을 채운 항목은 수급 상태가 '검증 필요'로 바뀝니다 (검증은 화면에서 직접).",
        "3. 필수 표시는 확정되지 않은 임시 기준입니다.",
    ]:
        info.append([line])
    info.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export(case):
    return _book(case)


def template():
    return _book(None)


def parse(case, data):
    """→ {rows: [{line, id, name, changes, issues}], updates: [...], counts}"""
    ensure_case_data(case)
    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    ws = wb["체크리스트"] if "체크리스트" in wb.sheetnames else wb.worksheets[0]
    raw = [list(r) for r in ws.iter_rows(values_only=True)]
    header = [str(h or "").strip() for h in (raw[0] if raw else [])]
    if header[:1] != ["ID"] or len(header) <= VALUE_COL or header[VALUE_COL] != "측정값":
        raise ValueError("'ID' 와 '측정값' 열이 있는 표준 양식이 아닙니다. 표준 양식을 내려받아 쓰세요.")
    current = {r.item_id: r for r in case.checklist.all()}
    prog = kit.to_kit_progress(current.values())
    res = kit.checklist.import_reply(kit.C(), prog, raw[1:])
    nxt = res["progress"]
    rows, updates, seen = [], [], set()
    for line_no, r in enumerate(raw[1:], start=2):
        iid = str(r[0] if r and r[0] is not None else "").strip()
        if not iid or iid == "ID":
            continue
        if iid not in reg.BY_ID:
            rows.append({"line": line_no, "id": iid, "name": None, "changes": {}, "issues": [{"level": "error", "message": "알 수 없는 항목 ID"}]})
            continue
        if iid in seen:
            rows.append({"line": line_no, "id": iid, "name": reg.BY_ID[iid]["name"]["ko"], "changes": {},
                         "issues": [{"level": "error", "message": "같은 항목 ID 가 두 번 나옵니다"}]})
            continue
        seen.add(iid)
        item, cur, p = reg.BY_ID[iid], current[iid], nxt.get(iid) or {}
        issues, changes, u = [], {}, {"id": iid}
        cell = r[VALUE_COL] if len(r) > VALUE_COL else None
        new_value = p.get("value") if cell is not None and str(cell).strip() != "" else None  # import_reply 가 이 행 값을 넣은 경우
        if new_value is not None:
            if item["data_type"] == "number":
                try:
                    float(str(new_value).replace(",", ""))
                except ValueError:
                    issues.append({"level": "error", "message": f"측정값 '{new_value}' 이(가) 숫자가 아닙니다"})
            if new_value != cur.value:
                changes["value"] = [cur.value or "", new_value]
            u["value"] = new_value
            new_supply = kit.SUPPLY_FROM_KIT[p["supply"]]
            if new_supply != cur.supply_status:
                changes["supply_status"] = [cur.supply_status, new_supply]
                u["supply_status"] = new_supply
        rows.append({"line": line_no, "id": iid, "name": item["name"]["ko"], "changes": changes, "issues": issues})
        if len(u) > 1:
            updates.append(u)
    counts = {lv: sum(1 for r in rows for i in r["issues"] if i["level"] == lv) for lv in ("error", "warning", "info")}
    counts["rows"] = len(rows)
    counts["changed"] = sum(1 for r in rows if r["changes"])
    counts["updated"] = res["updated"]
    return {"rows": rows, "updates": updates, "counts": counts}


def apply(case, data):
    out = parse(case, data)
    if out["counts"]["error"]:
        return out, False, None
    changed, errors = update_checklist(case, out["updates"])
    return out, errors is None, errors
