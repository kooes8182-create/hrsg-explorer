# 계산기 기대값 테스트 (Python 판, calc.test.mjs 와 같은 값): python -m unittest discover -s <키트 폴더> -p "test_*.py"
import copy
import unittest

import calc as c

D = c.load_calculator_data()


class TestCalc(unittest.TestCase):
    def near(self, x, y, tol):
        self.assertLessEqual(abs(x - y), tol, f'{x} != {y} (±{tol})')

    def test_default_case(self):
        r = c.calculate(c.default_inputs(D), D)
        self.near(r['loss']['gt_mw'], 1.08, 1e-9)
        self.near(r['loss']['st_mw'], 0.81, 1e-9)
        self.assertEqual(c.format_krw(r['annual_loss_krw']), '22.68억 원')
        self.assertEqual(c.format_krw(r['monthly_loss_krw']), '2.04억 원')
        self.near(r['excess_pressure']['mmh2o'], 50.99, 0.01)
        self.assertEqual(r['indicators']['hrsg_dp_mbar']['level'], 'caution')
        self.assertEqual(r['overall_level'], 'caution')
        self.near(r['index']['value'], 41.15, 0.01)
        self.near(r['index']['pressure_part'], 33.33, 0.01)
        self.near(r['index']['temp_part'], 7.81, 0.01)
        self.near(r['efficiency']['now'], 0.8632, 0.0001)
        self.near(r['efficiency']['after'], 0.8671, 0.0001)
        self.near(r['default_method']['recovered_mw'], 0.8505, 1e-9)
        self.assertEqual(r['warnings'], [])
        self.assertEqual(r['input_warnings'], [])

    def test_methods(self):
        m = c.compare_methods(c.default_inputs(D), D)
        self.assertEqual(m['best_payback_id'], 'dryice')
        self.assertEqual(m['max_net_benefit_id'], 'chemical')
        row = m['rows'][0]
        self.assertEqual(row['id'], 'mechanical')
        self.assertEqual(c.format_krw(row['outage_loss_krw']), '1.75억 원')
        self.assertEqual(c.format_krw(row['total_investment_krw']), '3.25억 원')
        self.near(row['payback_months'], 3.54, 0.005)
        k = c.calculate(c.default_inputs(D), D)['kpi']
        self.assertEqual(k['method_name'], '드라이아이스 세정')
        self.near(k['payback_months'], 3.12, 0.005)
        self.near(k['breakeven_days'], 93.6, 0.05)
        self.assertEqual([x['id'] for x in c.compare_methods(c.default_inputs(D), D, 'payback')['rows']], ['dryice', 'water', 'mechanical', 'chemical'])

    def test_design_state(self):
        r = c.calculate(c.design_inputs(D), D)
        self.assertEqual(r['loss']['total_mw'], 0)
        self.assertEqual(r['index']['value'], 0)
        self.assertEqual(r['overall_level'], 'normal')
        self.near(r['efficiency']['now'], 0.8718, 0.0001)
        self.assertTrue(all(x['payback_months'] is None for x in r['methods']['rows']))
        self.assertIsNone(r['methods']['max_net_benefit_id'])

    def test_units_and_strings(self):
        inp = c.default_inputs(D)
        eq = inp['equipment']
        bp, dp = eq.pop('gt_bp_mbar'), eq.pop('hrsg_dp_mbar')
        eq.update({'gt_bp_mmh2o': str(bp / 0.0980665), 'hrsg_dp_kpa': dp / 10, 'stack_c': '95', 'load_pct': '100'})
        inp['economics'] = {'price_krw_per_mwh': 150000, 'annual_hours': 8000, 'monthly_hours': 720}
        r = c.calculate(inp, D)
        self.near(r['loss']['total_mw'], 1.89, 1e-9)
        self.assertEqual(r['input_warnings'], [])

    def test_overrides_and_warning(self):
        inp = c.default_inputs(D)
        inp['equipment'].update({'rated_gt_mw': 150, 'base_stack_c': 95})
        inp['methods'] = [{'id': 'dryice', 'name': '드라이아이스 세정', 'cost_krw': 35000000, 'outage_days': 2, 'indirect_krw': 0, 'recovery_ratio': None, 'recovery_mw': None},
                          {'id': 'hp_water', 'name': '고압수 세정', 'cost_krw': None, 'outage_days': None, 'indirect_krw': None, 'recovery_ratio': None, 'recovery_mw': None}]
        inp['economics']['target_recovery_mw'] = 2.1
        r = c.calculate(inp, D)
        self.near(r['loss']['total_mw'], 0.6, 1e-9)
        self.assertEqual(r['methods']['rows'][0]['recovery_basis'], 'target')
        self.assertEqual(r['methods']['rows'][1]['message'], '산출 불가 — 입력 필요: 세정 비용, 정지일수, 간접 비용')
        self.assertEqual(len(r['warnings']), 1)
        self.assertTrue(r['warnings'][0].startswith('드라이아이스 세정의 회수 출력(2.1 MW)이 현재 출력 손실(0.6 MW)보다 큽니다.'))

    def test_validation(self):
        bad = c.default_inputs(D)
        del bad['equipment']['gt_bp_mbar']
        bad['equipment']['backpressure'] = 413
        bad['equipment']['hrsg_dp_kpa'] = 3
        bad['economics']['price_krw_per_kwh'] = 150000
        bad['equipment']['gt_class'] = 'G'
        v = c.validate_inputs(bad, D)
        self.assertFalse(v['ok'])
        self.assertTrue(any(e.startswith('equipment.gt_class (가스터빈 등급) 값 "G" 를 모릅니다.') for e in v['errors']))
        self.assertTrue(any(e.startswith('equipment.gt_bp_<단위> (GT 배압(현재 배압)) 값이 없습니다.') for e in v['errors']))
        self.assertTrue(any(e.startswith('equipment.hrsg_dp 가 두 단위로 들어왔습니다') for e in v['errors']))
        self.assertTrue(any(w.startswith('equipment.backpressure 는 키트가 쓰지 않는 이름') for w in v['warnings']))
        self.assertTrue(any('price_krw_per_mwh 에 넣어 주세요' in w for w in v['warnings']))
        with self.assertRaisesRegex(TypeError, '계산기 입력이 키트 형식과 맞지 않습니다'):
            c.calculate(bad, D)
        mm = c.default_inputs(D)
        mm['equipment']['gt_bp_mbar'] = 413
        self.assertTrue(any('너무 큽니다' in w for w in c.validate_inputs(mm, D)['warnings']))

    def test_trend_and_curve(self):
        t = c.efficiency_trend(c.default_inputs(D), D)
        self.assertEqual(len(t['months']), 13)
        self.near(t['months'][12]['eff'], 0.8632, 0.0001)
        cv = c.loss_curve(c.default_inputs(D), D, param='hrsg_dp')
        self.near(cv['points'][0]['loss_mw'], 0.81, 1e-9)
        self.near(cv['points'][-1]['loss_mw'], 0.81 + 270 * 0.0008 * 15, 1e-9)
        self.assertEqual(c.loss_curve(c.default_inputs(D), D, param='gt_bp')['current']['mbar'], 30)

    def test_pinch_and_key_indicators(self):
        self.near(c.saturation_temp_c(0.1), 99.606, 0.001)
        self.near(c.saturation_temp_c(10), 310.999, 0.001)
        k = c.key_indicators(c.default_inputs(D), D)
        self.assertEqual([s['level'] for s in k['sections']], ['normal', 'no_data', 'no_data'])
        self.near(k['kpi']['hp_pinch_c']['value'], 8, 0.1)
        self.assertEqual(k['kpi']['hp_steam_tph']['value'], 270)
        self.assertEqual(k['kpi']['cleaning_cost_krw']['method'], '기계식 세정')
        inp = c.default_inputs(D)
        inp['sections']['HP']['econ_outlet_water_c'] += 6
        self.assertEqual(c.key_indicators(inp, D)['sections'][0]['level'], 'danger')
        self.near(c.to_mbar(1, 'inh2o'), 2.49089, 1e-9)

    def test_does_not_change_input(self):
        inp = c.default_inputs(D)
        before = copy.deepcopy(inp)
        c.calculate(inp, D)
        self.assertEqual(inp, before)


if __name__ == '__main__':
    unittest.main()
