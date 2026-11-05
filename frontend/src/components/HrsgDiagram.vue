<script setup>
import { computed } from 'vue'
import { t } from '../i18n/index.js'
import { num, pressure } from '../format.js'

// HRSG 흐름 도식 (정적). 가스 흐름: 가스터빈 배기 → HRSG(과열기→증발기→절탄기) → 굴뚝 (왼→오른, 굵은 실선)
// 급수·증기 흐름: 급수 → 절탄기 → 증발기·드럼 → 과열기 → 스팀터빈 (오른→왼, 가는 점선)
// GT 배압과 HRSG 차압(ΔP)은 서로 다른 측정점으로 표시합니다. 값이 없으면 '—' (0 아님).
const props = defineProps({ values: Object, virtual: Boolean })

const show = (key, unit) => {
  const v = props.values?.[key]
  if (v === null || v === undefined || v === '') return '—'
  if (unit === 'kPa') {
    const p = pressure(v) // 화면 압력 단위 (kPa / in H2O / mbar)
    return `${p.text} ${p.unit}`
  }
  return `${num(v)} ${unit}`
}
const gtName = computed(() => props.values?.gt_model || '')
const d = (k) => t('views.evaluate.diagram.' + k)
</script>

<template>
  <figure class="hrsg-diagram mb-0">
    <div class="diagram-scroll">
      <svg viewBox="0 0 760 270" role="img" :aria-label="d('title')">
        <defs>
          <marker id="arr-gas" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" class="fill-gas" />
          </marker>
          <marker id="arr-water" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9" class="stroke-water" fill="none" stroke-width="2" />
          </marker>
        </defs>

        <!-- 가스터빈 -->
        <rect x="16" y="88" width="120" height="74" rx="8" class="box" />
        <text x="76" y="120" text-anchor="middle" class="label-strong">{{ d('gt') }}</text>
        <text x="76" y="140" text-anchor="middle" class="label-small">{{ gtName }}</text>

        <!-- 가스 흐름: GT → HRSG -->
        <line x1="136" y1="125" x2="196" y2="125" class="flow-gas" marker-end="url(#arr-gas)" />
        <circle cx="160" cy="125" r="5" class="probe" />
        <text x="192" y="78" text-anchor="end" class="label-small">{{ d('backPressure') }}</text>
        <text x="160" y="97" text-anchor="middle" class="label-value">{{ show('gt_back_pressure', 'kPa') }}</text>
        <text x="76" y="182" text-anchor="middle" class="label-small">{{ d('exhaust') }} {{ show('gt_exhaust_temp', '°C') }}</text>

        <!-- HRSG 본체 (3개 모듈) -->
        <rect x="200" y="70" width="380" height="110" rx="6" class="box" />
        <line x1="327" y1="70" x2="327" y2="180" class="divider" />
        <line x1="453" y1="70" x2="453" y2="180" class="divider" />
        <text x="263" y="118" text-anchor="middle" class="label">{{ d('sh') }}</text>
        <text x="390" y="118" text-anchor="middle" class="label">{{ d('ev') }}</text>
        <text x="516" y="118" text-anchor="middle" class="label">{{ d('eco') }}</text>
        <!-- HRSG 내부 가스 흐름 -->
        <line x1="210" y1="150" x2="570" y2="150" class="flow-gas" marker-end="url(#arr-gas)" />

        <!-- 차압 ΔP: 입구·출구 측정점 -->
        <circle cx="205" cy="150" r="5" class="probe" />
        <circle cx="575" cy="150" r="5" class="probe" />
        <path d="M 205 192 L 205 200 L 575 200 L 575 192" class="bracket" />
        <text x="390" y="220" text-anchor="middle" class="label-small">{{ d('dp') }}</text>
        <text x="390" y="238" text-anchor="middle" class="label-value">{{ show('hrsg_dp', 'kPa') }}</text>

        <!-- 가스 흐름: HRSG → 굴뚝 -->
        <line x1="580" y1="150" x2="640" y2="150" class="flow-gas" marker-end="url(#arr-gas)" />
        <rect x="644" y="30" width="44" height="150" rx="4" class="box" />
        <line x1="666" y1="40" x2="666" y2="10" class="flow-gas" marker-end="url(#arr-gas)" />
        <text x="666" y="200" text-anchor="middle" class="label">{{ d('stack') }}</text>
        <text x="666" y="218" text-anchor="middle" class="label-value">{{ show('stack_temp', '°C') }}</text>

        <!-- 급수·증기 흐름 (점선, 오른→왼) -->
        <path d="M 620 40 L 516 40 L 516 70" class="flow-water" marker-end="url(#arr-water)" />
        <text x="600" y="32" text-anchor="middle" class="label-small">{{ d('feedwater') }}</text>
        <path d="M 500 82 L 500 52 L 400 52 L 400 70" class="flow-water" marker-end="url(#arr-water)" />
        <path d="M 380 82 L 380 52 L 275 52 L 275 70" class="flow-water" marker-end="url(#arr-water)" />
        <path d="M 252 82 L 252 30 L 210 30 L 210 8" class="flow-water" marker-end="url(#arr-water)" />
        <text x="216" y="18" class="label-small">{{ d('steam') }} {{ show('steam_flow', 't/h') }}</text>

        <!-- 범례 -->
        <line x1="20" y1="256" x2="60" y2="256" class="flow-gas" />
        <text x="68" y="260" class="label-small">{{ d('gas') }}</text>
        <line x1="170" y1="256" x2="210" y2="256" class="flow-water" />
        <text x="218" y="260" class="label-small">{{ d('water') }}</text>
        <circle cx="390" cy="256" r="5" class="probe" />
        <text x="400" y="260" class="label-small">{{ d('backPressure') }} · ΔP</text>
        <text v-if="virtual" x="740" y="260" text-anchor="end" class="label-small">({{ d('virtual') }})</text>
      </svg>
    </div>
  </figure>
</template>
