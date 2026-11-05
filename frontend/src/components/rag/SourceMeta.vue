<script setup>
import { computed } from 'vue'
import { t } from '../../i18n/index.js'

// 근거 문단의 출처: 문헌명, 저자·연도, 파일명, PDF 페이지(실제 위치), 인쇄 페이지(PDF 에 라벨이 있을 때만), DOI·공개 링크
const props = defineProps({ src: { type: Object, required: true }, compact: Boolean })
const link = computed(() => props.src.doi || props.src.url)
const who = computed(() => [props.src.first_author, props.src.year].filter(Boolean).join(', '))
</script>

<template>
  <div class="rag-meta">
    <div class="fw-semibold rag-title">{{ src.title || src.doc_id }}</div>
    <div class="small text-body-secondary d-flex flex-wrap column-gap-2">
      <span v-if="who">{{ who }}</span>
      <span class="rag-page">{{ t('views.papers.pdfPage', { p: src.pdf_page }) }}</span>
      <span v-if="src.printed_page">{{ t('views.papers.printedPage', { p: src.printed_page }) }}</span>
      <span class="badge rounded-pill text-bg-light border">
        {{ src.source_type === 'summary_note' ? t('views.papers.sourceNote') : t('views.papers.sourcePdf') }}
      </span>
    </div>
    <div v-if="!compact" class="small text-body-secondary rag-file">
      {{ t('views.papers.file') }}: {{ src.file_name }} ·
      <a v-if="link" :href="link" target="_blank" rel="noopener noreferrer">{{ src.doi ? 'DOI' : t('views.papers.link') }} ↗</a>
      <span v-else>{{ t('views.papers.noLink') }}</span>
    </div>
  </div>
</template>
