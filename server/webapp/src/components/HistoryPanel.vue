<script setup>
import FaIcon from './FaIcon.vue';
defineProps({
  jobs: { type: Array, default: () => [] },
  loading: Boolean,
});

const emit = defineEmits(['refresh']);

const statusLabel = status => ({
  pending: 'В очереди',
  sent: 'Передано агенту',
  printing: 'Печать',
  done: 'Напечатано',
  failed: 'Ошибка',
})[status] || status || '—';

const sourceLabel = job => {
  if (job.source === 'marketplace') {
    return job.marketplace === 'ozon'
      ? 'Ozon'
      : job.marketplace === 'wb'
        ? 'WB'
        : 'Яндекс';
  }
  if (job.source === 'telegram') return 'Telegram';
  if (job.source === 'library') return 'Локальный файл';
  return 'Ручная загрузка';
};

function fmt(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <section class="history-panel">
    <header class="history-panel-header">
      <div class="history-panel-heading">
        <h2>История печати</h2>
        <span>
          {{ jobs.length ? `Последние задания: ${jobs.length}` : 'Пока пусто' }}
        </span>
      </div>

      <button
        class="mini-refresh history-panel-refresh"
        type="button"
        :class="{ 'is-loading': loading }"
        :disabled="loading"
        aria-label="Обновить историю печати"
        @click="emit('refresh')"
      >
        <span v-if="loading" class="button-spinner"></span><FaIcon v-else name="refresh" />
      </button>
    </header>

    <div v-if="!jobs.length" class="empty compact-empty history-panel-empty">
      История печати пока пуста.
    </div>

    <TransitionGroup
      v-else
      name="history-card"
      tag="div"
      class="history-list history-list-scroll history-list-static"
    >
      <article
        v-for="job in jobs"
        :key="job.id"
        class="history-item"
        :class="{ 'history-item-error': Boolean(job.error) }"
      >
        <div class="history-top">
          <div class="history-main">
            <div class="history-title">{{ job.title }}</div>

            <div class="sub">
              {{ sourceLabel(job) }} ·
              {{ String(job.profile || '—').replace('x','×') }} ·
              {{ job.copies || 1 }} шт.
            </div>
          </div>

          <div class="history-side">
            <span class="job-status" :class="`job-${job.status}`">
              {{ statusLabel(job.status) }}
            </span>

            <time>{{ fmt(job.doneAt || job.updatedAt || job.createdAt) }}</time>
          </div>
        </div>

        <div v-if="job.error" class="history-error" :title="job.error">
          <span class="history-error-label">Ошибка</span>
          <div class="history-error-message">{{ job.error }}</div>
        </div>
      </article>
    </TransitionGroup>
  </section>
</template>
