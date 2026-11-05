# 체크리스트 기대값 테스트 (Python 판, checklist.test.mjs 와 같은 값): python -m unittest discover -s <키트 폴더> -p "test_*.py"
import unittest

import checklist as k

C = k.load_checklist_data()


def item(item_id):
    return next(i for i in C['items'] if i['id'] == item_id)


class TestChecklist(unittest.TestCase):
    def test_initial(self):
        kp = k.kpis(C, {})
        self.assertEqual(kp['received'], {'done': 0, 'total': 49, 'percent': 0})
        self.assertEqual(kp['required'], {'done': 0, 'total': 16, 'percent': 0})
        self.assertEqual([f"{x['name']} {x['done']}/{x['total']}" for x in k.by_category(C, {})],
                         ['A. 가스터빈/운전 0/6', 'B. HRSG 열역학/설계 0/13', 'C. 세정/유지보수 0/9', 'D. 경제성 0/3', 'E. 확장 0/18'])
        self.assertEqual(k.summary(C, {})['all'], kp['received'])
        self.assertEqual(sum(1 for i in C['items'] if i['calc_input']), 22)

    def test_distribution(self):
        d = k.distribution(C, {})
        self.assertEqual(d['supply'], {'not_entered': 49, 'requested': 0, 'received': 0, 'verify_needed': 0, 'na': 0})
        self.assertEqual(' '.join(d['missing_required']), 'A-01 A-02 A-03 A-04 A-05 B-01 B-02 B-05 B-06 B-07 B-08 D-01 D-03 E-01 E-13 E-16')
        self.assertEqual([r['counts']['not_entered'] for r in k.matrix(C, {})], [6, 13, 9, 3, 18])

    def test_progress(self):
        prog = {'A-01': {'supply': 'received', 'verify': 'verified', 'reviewed': True}, 'A-02': {'supply': 'verify_needed', 'verify': 'failed'},
                'B-13': {'supply': 'na'}, 'B-03': {'supply': 'requested'}}
        kp = k.kpis(C, prog)
        self.assertEqual(kp['received'], {'done': 2, 'total': 48, 'percent': 4})
        self.assertEqual(kp['reviewed']['done'], 1)
        self.assertEqual(kp['verified']['done'], 1)
        self.assertEqual(kp['required']['done'], 1)
        self.assertEqual(k.distribution(C, prog)['missing_required'][0], 'A-03')

    def test_filters_and_labels(self):
        self.assertEqual(len(k.filter_items(C, {})), 49)
        self.assertEqual(len(k.filter_items(C, {}, required_only=True)), 16)
        self.assertEqual(len(k.filter_items(C, {}, category='D')), 3)
        self.assertEqual(len(k.filter_items(C, {}, query='e-16')), 1)
        self.assertEqual(len(k.filter_items(C, {}, query='핀치')), 5)
        self.assertEqual(len(k.filter_items(C, {'A-01': {'supply': 'received'}, 'B-13': {'supply': 'na'}}, incomplete_only=True)), 47)
        self.assertEqual(k.priority_label(C, item('A-02')), '필수 · 높음')
        self.assertEqual(k.priority_label(C, item('A-02'), 'simple'), '필수')
        self.assertEqual(k.priority_label(C, item('B-13'), 'simple'), '선택')
        self.assertEqual(k.measure_cell(item('B-13'), {}), '문서')
        self.assertEqual(k.measure_cell(item('A-02'), {'A-02': {'value': '405'}}), '405')
        self.assertEqual(k.detail_line(item('A-02')), '초과 배압과 출력 손실 계산 · 단위 mmH₂O 또는 mbar')

    def test_email(self):
        t = k.email_draft(C, {}, ids=['A-02', 'D-01'], plant='A 발전소')
        self.assertTrue(t.startswith('A 발전소 HRSG 성능 진단을 위해'))
        self.assertIn('- A-02 운전 배압 (mmH₂O 또는 mbar) — 초과 배압과 출력 손실 계산 [필수]', t)
        self.assertTrue('[D. 경제성]' in t and '[C. 세정/유지보수]' not in t)
        allt = k.email_draft(C, {'A-01': {'supply': 'received'}})
        self.assertTrue('A-01 ' not in allt and '- E-18 ' in allt)

    def test_export_import(self):
        rows = k.export_rows(C, {}, template=True)
        self.assertEqual(len(rows), 49)
        rows[1][7] = '405'
        r = k.import_reply(C, {}, [['ID'], *rows, ['Z-99', '', '', '', '', '', '', '1']])
        self.assertEqual(r['updated'], 1)
        self.assertEqual(r['unknown'], ['Z-99'])
        self.assertEqual(r['progress']['A-02'], {'value': '405', 'supply': 'verify_needed', 'verify': 'unverified'})

    def test_validate_progress(self):
        self.assertTrue(k.validate_progress(C, {'A-01': {'supply': 'received', 'verify': 'verified', 'reviewed': True}})['ok'])
        v = k.validate_progress(C, {'gt_model': {'supply': 'received'}, 'A-02': {'supply': '수령 완료', 'status': 'x'}, 'A-03': {'supply': '해당 없음'}})
        self.assertEqual(len(v['errors']), 3)
        self.assertTrue(v['errors'][0].startswith('항목 ID gt_model 는 체크리스트에 없습니다'))
        self.assertIn('"received"', v['errors'][1])
        self.assertIn('"na"', v['errors'][2])
        self.assertTrue(v['warnings'][0].startswith('A-02.status'))


if __name__ == '__main__':
    unittest.main()
