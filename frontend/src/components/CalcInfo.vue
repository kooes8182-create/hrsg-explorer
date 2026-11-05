<script setup>
import { t } from '../i18n/index.js'
import { dateTime, num, txt, unit } from '../format.js'

// 계산 정보: 입력 조건(값·단위·출처), 계산 시점, 데이터 출처, 모델·데모 버전
defineProps({ meta: Object })
</script>

<template>
  <details v-if="meta" class="calc-info mt-3">
    <summary class="small fw-semibold">{{ t('views.evaluate.calcInfo') }}</summary>
    <dl class="row small mb-2 mt-2">
      <dt class="col-5 col-md-4">{{ t('views.evaluate.computedAt') }}</dt><dd class="col-7 col-md-8">{{ dateTime(meta.computed_at) }}</dd>
      <dt class="col-5 col-md-4">{{ t('views.evaluate.dataSource') }}</dt><dd class="col-7 col-md-8">{{ txt(meta.data_source) }}</dd>
      <dt class="col-5 col-md-4">{{ t('views.evaluate.version') }}</dt><dd class="col-7 col-md-8"><code>{{ meta.model_version }}</code></dd>
    </dl>
    <div class="table-responsive">
      <table class="table table-sm small mb-0">
        <caption class="caption-top">{{ t('views.evaluate.inputConditions') }}</caption>
        <tbody>
          <tr v-for="r in meta.inputs" :key="r.key">
            <th scope="row" class="fw-normal">{{ txt(r.label) }}</th>
            <td class="text-end text-nowrap">{{ num(r.value) }} {{ r.value === null ? '' : unit(r.unit) }}</td>
            <td v-if="r.source !== undefined" class="text-nowrap text-body-secondary">
              {{ r.source ? t('views.evaluate.source' + r.source) : '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
