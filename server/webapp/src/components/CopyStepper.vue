<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Number, default: 1 },
  min: { type: Number, default: 1 },
  max: { type: Number, default: 99 },
  compact: Boolean,
  label: { type: String, default: 'Количество копий' },
});

const emit = defineEmits(['update:modelValue']);

const value = computed(() => {
  const n = Math.trunc(Number(props.modelValue || props.min));
  return Math.min(props.max, Math.max(props.min, Number.isFinite(n) ? n : props.min));
});

function setValue(next) {
  const n = Math.trunc(Number(next));
  emit(
    'update:modelValue',
    Math.min(props.max, Math.max(props.min, Number.isFinite(n) ? n : props.min))
  );
}

function decrement() {
  setValue(value.value - 1);
}

function increment() {
  setValue(value.value + 1);
}
</script>

<template>
  <div class="copy-stepper-field" :class="{ compact }">
    <span v-if="label" class="copy-stepper-label">{{ label }}</span>

    <div class="copy-stepper" role="group" :aria-label="label || 'Количество копий'">
      <button
        type="button"
        class="copy-stepper-button"
        :disabled="value <= min"
        aria-label="Уменьшить количество копий"
        @click="decrement"
      >
        −
      </button>

      <input
        class="copy-stepper-value"
        type="number"
        inputmode="numeric"
        :min="min"
        :max="max"
        :value="value"
        aria-label="Количество копий"
        @input="setValue($event.target.value)"
      />

      <button
        type="button"
        class="copy-stepper-button"
        :disabled="value >= max"
        aria-label="Увеличить количество копий"
        @click="increment"
      >
        +
      </button>
    </div>
  </div>
</template>
