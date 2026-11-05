<script setup>
import { ref } from 'vue'
import { store, selectCase, createCase, dirtyCount } from '../store.js'
import { t } from '../i18n/index.js'
import AppModal from './AppModal.vue'
import CaseForm from './CaseForm.vue'

const showNew = ref(false)

function onChange(e) {
  selectCase(Number(e.target.value))
}
</script>

<template>
  <div class="d-flex align-items-center gap-2 case-selector">
    <select v-if="store.cases.length" class="form-select form-select-sm" :aria-label="t('case.select')"
      :value="store.currentCaseId" @change="onChange">
      <option v-for="c in store.cases" :key="c.id" :value="c.id">
        {{ c.name }}{{ dirtyCount(c.id) ? ' • ' + t('common.unsavedShort') : '' }}
      </option>
    </select>
    <button v-if="store.casesLoaded" class="btn btn-sm btn-outline-primary text-nowrap" @click="showNew = true">
      + {{ t('case.new') }}
    </button>

    <AppModal v-if="showNew" :title="t('case.new')" @close="showNew = false">
      <CaseForm :submit="createCase" :submit-label="t('case.create')" @done="showNew = false" @cancel="showNew = false" />
    </AppModal>
  </div>
</template>
