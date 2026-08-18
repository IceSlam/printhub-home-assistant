<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { lockModalScroll, unlockModalScroll } from '../utils/modalScrollLock.js';
import CopyStepper from './CopyStepper.vue';
import FaIcon from './FaIcon.vue';
import ToggleSwitch from './ToggleSwitch.vue';

const props = defineProps({
  busy: Boolean,
  localCount: { type: Number, default: 0 },
});
const emit = defineEmits(['submit', 'save']);

const file = ref(null);
const profile = ref('auto');
const copies = ref(1);
const saveLocal = ref(false);
const input = ref(null);
const open = ref(false);
const modalLock = Symbol('manual-print-modal');

const autoProfile = {
  value: 'auto',
  title: 'Авто',
  caption: 'Определить по PDF',
  hint: 'По размеру PDF',
};

const sizeProfiles = [
  {
    value: '58x40',
    title: '58×40',
    caption: 'Этикетка отправления',
    hint: 'FBS / заказы',
  },
  {
    value: '58x60',
    title: '58×60',
    caption: 'Увеличенная этикетка',
    hint: 'Маркетплейсы / спец. размер',
  },
  {
    value: '75x120',
    title: '75×120',
    caption: 'Поставка / склад',
    hint: 'Поставки',
  },
];

const canSubmit = computed(() => file.value && !props.busy);

function changed(event) {
  file.value = event.target.files?.[0] || null;
}

function setCopies(value) {
  const n = Math.trunc(Number(value || 1));
  copies.value = Math.min(99, Math.max(1, Number.isFinite(n) ? n : 1));
}

function openPanel() {
  lockModalScroll(modalLock);
  open.value = true;
}

function closePanel() {
  open.value = false;
}

function afterLeave() {
  unlockModalScroll(modalLock);
}

function submit() {
  if (!canSubmit.value) return;
  emit('submit', {
    file: file.value,
    profile: profile.value,
    copies: copies.value,
    saveLocal: saveLocal.value,
    reset,
  });
}

function saveOnly() {
  if (!canSubmit.value) return;
  emit('save', {
    file: file.value,
    profile: profile.value,
    reset,
  });
}

function reset() {
  file.value = null;
  copies.value = 1;
  saveLocal.value = false;
  profile.value = 'auto';
  if (input.value) input.value.value = '';
}

onBeforeUnmount(() => unlockModalScroll(modalLock));
</script>

<template>
  <section class="card manual-launch-card">
    <div class="manual-launch-copy">
      <div class="eyebrow">MANUAL</div>
      <h2>Ручная печать</h2>
      <p>
        Загружайте PDF вручную, сохраняйте их в локальную библиотеку и печатайте повторно
        из одного раздела.
      </p>
    </div>

    <button class="manual-open-button" type="button" @click="openPanel">
      <FaIcon name="printer" class="manual-open-icon" />
      <span class="manual-open-main">
        <strong>Открыть ручную печать</strong>
        <small>Файлов в локальной библиотеке: {{ localCount }}</small>
      </span>
      <span class="manual-open-arrow">→</span>
    </button>
  </section>

  <Teleport to="body">
    <Transition name="sheet" @after-leave="afterLeave">
      <div v-if="open" class="manual-modal-overlay" @click.self="closePanel">
        <section class="manual-modal" role="dialog" aria-modal="true" aria-label="Ручная печать">
          <header class="manual-modal-header">
            <div>
              <div class="eyebrow">MANUAL</div>
              <strong>Ручная печать</strong>
              <span>Загрузите PDF. В режиме «Авто» размер определяется по первой странице файла.</span>
            </div>

            <button class="preview-close" type="button" aria-label="Закрыть" @click="closePanel"><FaIcon name="close" /></button>
          </header>

          <div class="manual-modal-body">
            <section class="card manual-upload-sheet">
              <label class="drop manual-drop" :title="file?.name || 'Выбрать PDF'">
                <input ref="input" type="file" accept="application/pdf,.pdf" @change="changed" />
                <span class="drop-filename" :class="{ 'is-selected': file }">
                  {{ file?.name || 'Выбрать PDF' }}
                </span>
              </label>

              <div class="profile-picker profile-picker-auto">
                <button
                  type="button"
                  class="profile-card profile-card-auto"
                  :class="{ active: profile === autoProfile.value }"
                  @click="profile = autoProfile.value"
                >
                  <strong>{{ autoProfile.title }}</strong>
                  <span>{{ autoProfile.caption }}</span>
                  <small>{{ autoProfile.hint }}</small>
                </button>
              </div>

              <div class="profile-picker profile-picker-sizes">
                <button
                  v-for="p in sizeProfiles"
                  :key="p.value"
                  type="button"
                  class="profile-card"
                  :class="{ active: profile === p.value }"
                  @click="profile = p.value"
                >
                  <strong>{{ p.title }}</strong>
                  <span>{{ p.caption }}</span>
                  <small>{{ p.hint }}</small>
                </button>
              </div>

              <div class="manual-options">
                <CopyStepper
                  :model-value="copies"
                  label="Количество копий"
                  @update:model-value="setCopies"
                />

                <ToggleSwitch
                  v-model="saveLocal"
                  title="Сохранить в локальные"
                  description="По умолчанию файл сохраняется только как задание печати."
                />
              </div>

              <div class="manual-action-stack">
                <button class="primary action-with-icon" type="button" :disabled="!canSubmit" @click="submit">
                  <FaIcon name="printer" />
                  <span>{{ busy ? 'Отправка…' : `Отправить на печать · ${copies} шт.` }}</span>
                </button>

                <button
                  class="secondary save-only-button"
                  type="button"
                  :disabled="!canSubmit"
                  @click="saveOnly"
                >
                  <FaIcon name="upload" />
                  <span>{{ busy ? 'Сохранение…' : 'Загрузить PDF' }}</span>
                </button>
              </div>
            </section>

            <section class="manual-library-section">
              <div class="manual-section-head">
                <div>
                  <h3>Локальная библиотека</h3>
                  <p>Сохранённые PDF с предпросмотром и повторной печатью.</p>
                </div>
              </div>

              <slot name="library" />
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
