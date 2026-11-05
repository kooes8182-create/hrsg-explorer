<script setup>
import { useEvaluation } from '../../composables/useEvaluation.js'
import { t } from '../../i18n/index.js'
import { txt } from '../../format.js'

// 앱이 참고한 공개 자료 전체 (원문에서 확인한 내용, 확인일). 원문 파일·링크는 제공하지 않습니다.
const ev = useEvaluation()
</script>

<template>
  <div v-if="ev.sources.value" class="card">
    <div class="card-header fw-semibold">{{ t('views.evaluate.sourcesTitle') }}</div>
    <div class="card-body">
      <p class="small text-body-secondary">{{ t('views.evaluate.sourcesHelp') }} {{ t('views.evaluate.checkedOn') }} {{ ev.sources.value.checked_on }}</p>
      <ol class="source-list mb-0">
        <li v-for="s in ev.sources.value.sources" :key="s.key">
          <div class="fw-semibold">{{ s.title }}</div>
          <div class="small text-body-secondary">{{ s.author }}<template v-if="s.year">, {{ s.year }}</template> · {{ s.where }}</div>
          <blockquote class="small mb-1">“{{ s.quote }}”</blockquote>
          <div class="small"><span class="text-body-secondary">{{ t('views.evaluate.scope') }}:</span> {{ txt(s.scope) }}</div>
        </li>
      </ol>
    </div>
  </div>
</template>
