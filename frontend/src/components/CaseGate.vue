<script setup>
import { store, currentCase, loadCases, createCase } from '../store.js'
import { t } from '../i18n/index.js'
import CaseForm from './CaseForm.vue'
import PageHeader from './PageHeader.vue'

// 화면 공통 머리말 + 케이스 상태(불러오는 중 / 실패 / 케이스 없음)를 처리합니다.
// 현재 케이스가 있을 때만 본문(slot)을 보여줍니다. 제목을 주지 않으면 머리말 없이 상태만 처리합니다.
defineProps({ titleKey: String, leadKey: String, eyebrowKey: String })
</script>

<template>
  <PageHeader v-if="titleKey" :title-key="titleKey" :lead-key="leadKey" :eyebrow-key="eyebrowKey" />

  <div v-if="store.casesError && !store.casesLoaded" class="alert alert-danger d-flex align-items-center gap-2">
    <span>{{ t('common.loadFailed') }}</span>
    <button class="btn btn-sm btn-light ms-auto" @click="loadCases">{{ t('server.retry') }}</button>
  </div>
  <div v-else-if="!store.casesLoaded" class="text-body-secondary py-4">
    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
  </div>
  <div v-else-if="!currentCase" class="card empty-state">
    <div class="card-body">
      <h2 class="h5">{{ t('case.none') }}</h2>
      <p class="text-body-secondary">{{ t('case.noneHelp') }}</p>
      <div style="max-width: 32rem">
        <CaseForm :submit="createCase" :submit-label="t('case.create')" :cancellable="false" />
      </div>
      <p class="small text-body-secondary mt-3 mb-0">{{ t('case.seedHint') }}</p>
    </div>
  </div>
  <slot v-else :case-id="currentCase.id" />
</template>
