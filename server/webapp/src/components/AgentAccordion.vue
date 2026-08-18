<script setup>
import { computed, ref } from 'vue';
import SmoothCollapse from './SmoothCollapse.vue';
const props = defineProps({ agent: { type: Object, default: null }, refreshing: Boolean });
const emit = defineEmits(['refresh']);
const open = ref(false);
const online = computed(() => Boolean(props.agent?.online));
const meta = computed(() => props.agent?.meta || {});
const cupsHealthy = computed(() => Boolean(meta.value.cupsSchedulerRunning && meta.value.cupsSocketPresent));
function fmt(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('ru-RU'); }
function yesNo(value) { return value === true ? 'Да' : value === false ? 'Нет' : '—'; }
</script>

<template>
  <section class="agent-accordion" :class="{ 'is-open': open }">
    <button class="accordion-summary" type="button" :aria-expanded="open" @click="open = !open">
      <span class="accordion-summary-copy">
        <strong>Агент и принтер</strong>
        <span>{{ online ? 'Подключён' : 'Офлайн' }}</span>
      </span>
      <span class="accordion-summary-end">
        <span class="status" :class="online ? 'online' : 'offline'">{{ online ? '🟢 Online' : '🔴 Offline' }}</span>
        <span class="accordion-chevron">▾</span>
      </span>
    </button>

    <SmoothCollapse :open="open">
      <div class="agent-content">
            <div class="agent-grid">
              <div><span>Последняя связь</span><strong>{{ fmt(agent?.lastSeen) }}</strong></div>
              <div><span>Режим подключения</span><strong>{{ meta.connectionMode || '—' }}</strong></div>
              <div><span>CUPS scheduler</span><strong :class="cupsHealthy ? 'health-ok' : 'health-bad'">{{ cupsHealthy ? 'Работает' : 'Недоступен' }}</strong></div>
              <div><span>CUPS socket</span><strong>{{ yesNo(meta.cupsSocketPresent) }}</strong></div>
              <div><span>USB / CUPS</span><strong>{{ meta.cupsPrinterUsb || meta.cupsPrinter || '—' }} · {{ meta.cupsQueueUsbExists === true ? 'очередь OK' : meta.cupsQueueUsbExists === false ? 'нет очереди' : '—' }}</strong></div>
              <div><span>IP / CUPS</span><strong>{{ meta.cupsPrinterIp || '—' }} · {{ meta.cupsQueueIpExists === true ? 'очередь OK' : meta.cupsQueueIpExists === false ? 'нет очереди' : '—' }}</strong></div>
              <div><span>CUPS диагностика</span><strong>{{ meta.cupsHealthDetail || '—' }}</strong></div>
              <div><span>Проверка CUPS</span><strong>{{ fmt(meta.cupsHealthUpdatedAt) }}</strong></div>
              <div><span>IP принтера</span><strong>{{ meta.printerHost ? `${meta.printerHost}:${meta.printerPort || 9100}` : '—' }}</strong></div>
              <div><span>Последняя печать</span><strong>{{ meta.lastPrintTransport || '—' }}</strong></div>
              <div><span>Состояние агента</span><strong>{{ meta.busy ? `Печать${meta.activeJobId ? ` · ${meta.activeJobId}` : ''}` : 'Свободен' }}</strong></div>
              <div><span>Очередь агента</span><strong>{{ Number(meta.queuedJobs || 0) }}</strong></div>
              <div><span>PDF режим</span><strong>{{ meta.pdfPrintMode || '—' }}</strong></div>
              <div><span>Версия агента</span><strong>{{ meta.version || '—' }}</strong></div>
            </div>
            <button class="secondary" type="button" :disabled="refreshing" @click="emit('refresh')">
              {{ refreshing ? 'Обновление…' : 'Обновить статус' }}
            </button>
      </div>
    </SmoothCollapse>
  </section>
</template>
