<script setup>
const props = defineProps({
  modelValue: Boolean,
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  disabled: Boolean,
});

const emit = defineEmits(['update:modelValue']);

function onChange(event) {
  emit('update:modelValue', Boolean(event.target.checked));
}
</script>

<template>
  <label class="toggle-field-webapp" :class="{ disabled }">
    <span class="toggle-field-copy">
      <strong v-if="title">{{ title }}</strong>
      <small v-if="description">{{ description }}</small>
    </span>

    <span class="toggle-switch-webapp">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        :aria-label="title || 'Переключатель'"
        @change="onChange"
      />
      <span class="toggle-switch-track" aria-hidden="true"></span>
    </span>
  </label>
</template>
