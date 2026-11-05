<script setup>
import { reactive, ref } from 'vue'
import { t } from '../i18n/index.js'

// 케이스 생성·수정 공용 폼. submit 함수는 부모가 넘기며, 실패하면 ApiError 를 던집니다.
const props = defineProps({
  initial: { type: Object, default: () => ({ name: '', memo: '' }) },
  submitLabel: String,
  submit: Function,
  cancellable: { type: Boolean, default: true },
})
const emit = defineEmits(['done', 'cancel'])

const form = reactive({ name: props.initial.name, memo: props.initial.memo })
const errors = ref({})
const message = ref('')
const busy = ref(false)

async function onSubmit() {
  busy.value = true
  errors.value = {}
  message.value = ''
  try {
    const result = await props.submit({ name: form.name, memo: form.memo })
    emit('done', result)
  } catch (err) {
    errors.value = err.fields || {}
    message.value = err.kind === 'input' ? t('common.inputError') : t('common.saveFailed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="mb-3">
      <label class="form-label" for="case-name">{{ t('case.name') }}</label>
      <input id="case-name" v-model="form.name" class="form-control" :class="{ 'is-invalid': errors.name }"
        maxlength="100" :placeholder="t('case.namePlaceholder')" required />
      <div v-if="errors.name" class="invalid-feedback">{{ errors.name.join(' ') }}</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="case-memo">{{ t('case.memo') }}</label>
      <textarea id="case-memo" v-model="form.memo" class="form-control" rows="2"></textarea>
    </div>
    <div v-if="message" class="alert alert-danger py-2">{{ message }}</div>
    <div class="d-flex gap-2 justify-content-end">
      <button v-if="cancellable" type="button" class="btn btn-outline-secondary" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button type="submit" class="btn btn-primary" :disabled="busy">
        {{ busy ? t('common.saving') : submitLabel || t('common.save') }}
      </button>
    </div>
  </form>
</template>
