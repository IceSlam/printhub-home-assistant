<script setup>
import { computed, onBeforeUnmount, watch } from 'vue';
import FaIcon from './FaIcon.vue';
import { lockModalScroll, unlockModalScroll } from '../utils/modalScrollLock.js';

const props = defineProps({
  open: Boolean,
  agent: { type: Object, default: null },
  refreshing: Boolean,
});

const emit = defineEmits(['close', 'refresh']);

const modalLock = Symbol('agent-status-modal');

const online = computed(() => Boolean(props.agent?.online));
const meta = computed(() => props.agent?.meta || {});
const cupsHealthy = computed(() =>
  Boolean(meta.value.cupsSchedulerRunning && meta.value.cupsSocketPresent)
);

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function yesNo(value) {
  return value === true ? 'Да' : value === false ? 'Нет' : '—';
}

function close() {
  emit('close');
}

function afterLeave() {
  unlockModalScroll(modalLock);
}

watch(
  () => props.open,
  value => {
    if (value) lockModalScroll(modalLock);
  },
  { immediate: true }
);

onBeforeUnmount(() => unlockModalScroll(modalLock));
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet" @after-leave="afterLeave">
      <div
        v-if="open"
        class="agent-modal-overlay"
        role="presentation"
        @click.self="close"
      >
        <section
          class="agent-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-modal-title"
        >
          <header class="agent-modal-header">
            <div class="agent-modal-title-wrap">
              <div class="eyebrow">STATUS</div>
              <h2 id="agent-modal-title">Агент и принтер</h2>
              <span
                class="agent-modal-status"
                :class="online ? 'online' : 'offline'"
              >
                <span class="agent-modal-status-dot" aria-hidden="true"></span>
                {{ online ? 'Онлайн' : 'Офлайн' }}
              </span>
            </div>

            <button
              class="preview-close agent-modal-close"
              type="button"
              aria-label="Закрыть"
              @click="close"
            >
              <FaIcon name="close" />
            </button>
          </header>

          <div class="agent-modal-body">
            <div class="agent-grid agent-modal-grid">
              <div>
                <span>Последняя связь</span>
                <strong>{{ fmt(agent?.lastSeen) }}</strong>
              </div>

              <div>
                <span>Режим подключения</span>
                <strong>{{ meta.connectionMode || '—' }}</strong>
              </div>

              <div>
                <span>CUPS scheduler</span>
                <strong :class="cupsHealthy ? 'health-ok' : 'health-bad'">
                  {{ cupsHealthy ? 'Работает' : 'Недоступен' }}
                </strong>
              </div>

              <div>
                <span>CUPS socket</span>
                <strong>{{ yesNo(meta.cupsSocketPresent) }}</strong>
              </div>

              <div>
                <span>USB / CUPS</span>
                <strong>
                  {{ meta.cupsPrinterUsb || meta.cupsPrinter || '—' }}
                  ·
                  {{
                    meta.cupsQueueUsbExists === true
                      ? 'очередь OK'
                      : meta.cupsQueueUsbExists === false
                        ? 'нет очереди'
                        : '—'
                  }}
                </strong>
              </div>

              <div>
                <span>IP / CUPS</span>
                <strong>
                  {{ meta.cupsPrinterIp || '—' }}
                  ·
                  {{
                    meta.cupsQueueIpExists === true
                      ? 'очередь OK'
                      : meta.cupsQueueIpExists === false
                        ? 'нет очереди'
                        : '—'
                  }}
                </strong>
              </div>

              <div class="agent-modal-grid-wide">
                <span>CUPS диагностика</span>
                <strong>{{ meta.cupsHealthDetail || '—' }}</strong>
              </div>

              <div>
                <span>Проверка CUPS</span>
                <strong>{{ fmt(meta.cupsHealthUpdatedAt) }}</strong>
              </div>

              <div>
                <span>IP принтера</span>
                <strong>
                  {{
                    meta.printerHost
                      ? `${meta.printerHost}:${meta.printerPort || 9100}`
                      : '—'
                  }}
                </strong>
              </div>

              <div class="agent-modal-grid-wide">
                <span>Последняя печать</span>
                <strong>{{ meta.lastPrintTransport || '—' }}</strong>
              </div>

              <div>
                <span>Состояние агента</span>
                <strong>
                  {{
                    meta.busy
                      ? `Печать${meta.activeJobId ? ` · ${meta.activeJobId}` : ''}`
                      : 'Свободен'
                  }}
                </strong>
              </div>

              <div>
                <span>Очередь агента</span>
                <strong>{{ Number(meta.queuedJobs || 0) }}</strong>
              </div>

              <div>
                <span>PDF режим</span>
                <strong>{{ meta.pdfPrintMode || '—' }}</strong>
              </div>

              <div>
                <span>Версия агента</span>
                <strong>{{ meta.version || '—' }}</strong>
              </div>
            </div>

            <button
              class="secondary agent-modal-refresh"
              type="button"
              :disabled="refreshing"
              @click="emit('refresh')"
            >
              <span
                v-if="refreshing"
                class="button-spinner"
                aria-hidden="true"
              ></span>
              <FaIcon v-if="!refreshing" name="refresh" />
              <span>{{ refreshing ? 'Обновление…' : 'Обновить статус' }}</span>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
