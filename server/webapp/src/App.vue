<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AuthGate from './components/AuthGate.vue';
import ManualUpload from './components/ManualUpload.vue';
import LocalFiles from './components/LocalFiles.vue';
import PrintableList from './components/PrintableList.vue';
import HistoryPanel from './components/HistoryPanel.vue';
import AgentStatusModal from './components/AgentStatusModal.vue';
import NotificationStack from './components/NotificationStack.vue';
import FaIcon from './components/FaIcon.vue';
import { usePrintHubApi } from './composables/usePrintHubApi.js';

const { tg, initData, request } = usePrintHubApi();

const logoUrl = `${import.meta.env.BASE_URL}printhub-logo.svg`;
const splashVisible = ref(true);
const splashStartedAt = Date.now();
const SPLASH_MIN_MS = 1500;

const authStatus = ref('checking');
const authMessage = ref('Проверяем авторизацию Telegram…');
const user = ref(null);

const documents = ref([]);
const errors = ref([]);
const agent = ref(null);
const localFiles = ref([]);
const history = ref([]);

const loadingDocs = ref(false);
const loadingLocalFiles = ref(false);
const loadingHistory = ref(false);
const refreshingAgent = ref(false);
const agentModalOpen = ref(false);
const uploading = ref(false);

const printingKey = ref('');
const printingLocalId = ref('');
const renamingLocalId = ref('');
const favoriteLocalId = ref('');
const deletingLocalId = ref('');

const notifications = ref([]);
const notificationTimers = new Map();
const deferredNotifications = new Map();
let notificationSequence = 0;
let notificationsReady = false;

const previousJobStatuses = new Map();
let historyPrimed = false;
let lastAgentOnline = null;

let docsTimer = null;
let agentTimer = null;
let historyTimer = null;

const agentOnline = computed(() => Boolean(agent.value?.online));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function publishNotification(item) {
  notifications.value = [...notifications.value.slice(-3), item];
  scheduleNotificationRemoval(item);
  if (item.type !== 'loading') haptic(item.type);
}

function flushDeferredNotifications() {
  if (!deferredNotifications.size) return;
  const items = [...deferredNotifications.values()].slice(-4);
  deferredNotifications.clear();
  for (const item of items) publishNotification(item);
}

async function finishSplash() {
  const elapsed = Date.now() - splashStartedAt;
  const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
  if (remaining > 0) await sleep(remaining);
  splashVisible.value = false;
  // Wait until the leave-transition is visually finished before surfacing toasts.
  await sleep(320);
  notificationsReady = true;
  flushDeferredNotifications();
}

function openAgentModal() {
  agentModalOpen.value = true;
  try {
    tg?.HapticFeedback?.impactOccurred?.('light');
  } catch {
    // Telegram haptics are optional.
  }
}

function closeAgentModal() {
  agentModalOpen.value = false;
}

function haptic(type) {
  try {
    if (type === 'success' || type === 'error' || type === 'warning') {
      tg?.HapticFeedback?.notificationOccurred?.(type);
      return;
    }
    tg?.HapticFeedback?.impactOccurred?.('light');
  } catch {
    // Telegram haptics are optional.
  }
}

function clearNotificationTimer(id) {
  const timer = notificationTimers.get(id);
  if (timer) clearTimeout(timer);
  notificationTimers.delete(id);
}

function scheduleNotificationRemoval(item) {
  clearNotificationTimer(item.id);
  if (!item.duration || item.duration <= 0) return;

  notificationTimers.set(
    item.id,
    setTimeout(() => dismissNotification(item.id), item.duration)
  );
}

function notify(message, {
  title = '',
  type = 'info',
  duration = 3600,
} = {}) {
  const item = {
    id: `notice-${Date.now()}-${++notificationSequence}`,
    title,
    message: String(message || ''),
    type,
    duration,
  };

  if (!notificationsReady) deferredNotifications.set(item.id, item);
  else publishNotification(item);
  return item.id;
}

function updateNotification(id, patch = {}) {
  const deferred = deferredNotifications.get(id);
  if (deferred) {
    deferredNotifications.set(id, {
      ...deferred,
      ...patch,
      duration: patch.duration ?? deferred.duration,
    });
    return;
  }

  const index = notifications.value.findIndex(item => item.id === id);
  if (index < 0) return;

  const current = notifications.value[index];
  const next = {
    ...current,
    ...patch,
    duration: patch.duration ?? current.duration,
  };

  notifications.value = notifications.value.map(item => item.id === id ? next : item);
  scheduleNotificationRemoval(next);

  if (patch.type && patch.type !== 'loading') haptic(patch.type);
}

function dismissNotification(id) {
  deferredNotifications.delete(id);
  clearNotificationTimer(id);
  notifications.value = notifications.value.filter(item => item.id !== id);
}

function clearNotifications() {
  deferredNotifications.clear();
  for (const timer of notificationTimers.values()) clearTimeout(timer);
  notificationTimers.clear();
  notifications.value = [];
}

function deny(message) {
  authStatus.value = 'denied';
  authMessage.value = message;
  clearTimers();
}

function clearTimers() {
  if (docsTimer) clearInterval(docsTimer);
  if (agentTimer) clearInterval(agentTimer);
  if (historyTimer) clearInterval(historyTimer);
}

function handleAuthError(error) {
  if (error.status === 401 || error.status === 403) {
    deny(
      error.status === 403
        ? 'У этого Telegram-аккаунта нет доступа к PrintHub.'
        : 'Не удалось подтвердить авторизацию Telegram. Откройте WebApp заново из бота.'
    );
    return true;
  }
  return false;
}

function applyAgent(nextAgent, { announce = true } = {}) {
  const nextOnline = Boolean(nextAgent?.online);

  if (announce && lastAgentOnline !== null && nextOnline !== lastAgentOnline) {
    notify(
      nextOnline
        ? 'Соединение с печатным агентом восстановлено.'
        : 'Печатный агент перестал отвечать серверу.',
      {
        title: nextOnline ? 'Агент снова в сети' : 'Агент отключён',
        type: nextOnline ? 'success' : 'warning',
        duration: 5000,
      }
    );
  }

  lastAgentOnline = nextOnline;
  agent.value = nextAgent;
}

function processHistoryNotifications(items) {
  if (historyPrimed) {
    for (const job of items) {
      const previous = previousJobStatuses.get(job.id);
      if (!previous || previous === job.status) continue;

      if (job.status === 'done') {
        notify(
          `${job.title || `Задание #${job.id}`} успешно напечатано.`,
          { title: 'Печать завершена', type: 'success', duration: 4200 }
        );
      } else if (job.status === 'failed') {
        notify(
          job.error || `${job.title || `Задание #${job.id}`} завершилось ошибкой.`,
          { title: 'Ошибка печати', type: 'error', duration: 6500 }
        );
      }
    }
  }

  for (const job of items) {
    previousJobStatuses.set(job.id, job.status);
  }

  while (previousJobStatuses.size > 250) {
    const first = previousJobStatuses.keys().next().value;
    if (!first) break;
    previousJobStatuses.delete(first);
  }

  historyPrimed = true;
}

async function loadAgent() {
  if (authStatus.value !== 'ready') return;
  refreshingAgent.value = true;
  try {
    const data = await request('/api/webapp/agent-status');
    applyAgent(data.agent);
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось обновить агента',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    refreshingAgent.value = false;
  }
}

async function loadPrintables(force = false) {
  if (authStatus.value !== 'ready') return;
  loadingDocs.value = true;
  try {
    const data = await request(`/api/webapp/printables${force ? '?refresh=1' : ''}`);
    documents.value = data.documents || [];
    errors.value = data.errors || [];
    if (data.agent) applyAgent(data.agent);
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось обновить документы',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    loadingDocs.value = false;
  }
}

async function loadLocalFiles() {
  if (authStatus.value !== 'ready') return;
  loadingLocalFiles.value = true;
  try {
    const data = await request('/api/webapp/local-files');
    localFiles.value = data.files || [];
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Локальные файлы',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    loadingLocalFiles.value = false;
  }
}

async function loadHistory() {
  if (authStatus.value !== 'ready') return;
  loadingHistory.value = true;
  try {
    const data = await request('/api/webapp/history?limit=50');
    const jobs = data.jobs || [];
    processHistoryNotifications(jobs);
    history.value = jobs;
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось обновить историю',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    loadingHistory.value = false;
  }
}

async function uploadManual({ file, profile, copies, saveLocal, reset }) {
  uploading.value = true;

  const pendingNotice = notify(
    `${file.name} · ${copies} шт.`,
    { title: 'Отправляем на печать', type: 'loading', duration: 0 }
  );

  const form = new FormData();
  form.append('profile', profile);
  form.append('copies', String(copies));
  form.append('saveLocal', saveLocal ? 'true' : 'false');
  form.append('file', file);

  try {
    const data = await request('/api/webapp/upload', { method: 'POST', body: form });

    updateNotification(pendingNotice, {
      title: 'Задание отправлено',
      message:
        `#${data.job.id} · ${String(data.job.profile).replace('x','×')} · ${data.job.copies} шт.` +
        (data.savedFile ? ' · сохранено в библиотеке' : ''),
      type: 'success',
      duration: 4200,
    });

    reset();
    await Promise.all([
      loadAgent(),
      loadHistory(),
      data.savedFile ? loadLocalFiles() : Promise.resolve(),
    ]);
  } catch (error) {
    if (!handleAuthError(error)) {
      updateNotification(pendingNotice, {
        title: 'Не удалось отправить на печать',
        message: error.message,
        type: 'error',
        duration: 6500,
      });
    } else {
      dismissNotification(pendingNotice);
    }
  } finally {
    uploading.value = false;
  }
}

async function saveManualLocal({ file, profile, reset }) {
  uploading.value = true;

  const pendingNotice = notify(
    file.name,
    { title: 'Сохраняем PDF в локальные', type: 'loading', duration: 0 }
  );

  const form = new FormData();
  form.append('profile', profile);
  form.append('file', file);

  try {
    const data = await request('/api/webapp/local-files/upload', {
      method: 'POST',
      body: form,
    });

    updateNotification(pendingNotice, {
      title: 'PDF сохранён',
      message:
        `${data.file.name} · ${String(data.file.profile || 'auto').replace('x','×')}` +
        ' · без отправки на печать',
      type: 'success',
      duration: 4200,
    });

    reset();
    await loadLocalFiles();
  } catch (error) {
    if (!handleAuthError(error)) {
      updateNotification(pendingNotice, {
        title: 'Не удалось сохранить PDF',
        message: error.message,
        type: 'error',
        duration: 6500,
      });
    } else {
      dismissNotification(pendingNotice);
    }
  } finally {
    uploading.value = false;
  }
}

async function printDocument(doc) {
  printingKey.value = doc.key;

  const pendingNotice = notify(
    doc.title || 'Документ маркетплейса',
    { title: 'Отправляем на печать', type: 'loading', duration: 0 }
  );

  try {
    const data = await request(
      `/api/webapp/printables/${encodeURIComponent(doc.key)}/print`,
      { method: 'POST' }
    );

    updateNotification(pendingNotice, {
      title: 'Задание отправлено',
      message: `${doc.title || 'Документ'} · #${data.job.id}`,
      type: 'success',
      duration: 4200,
    });

    await Promise.all([loadPrintables(true), loadAgent(), loadHistory()]);
  } catch (error) {
    if (!handleAuthError(error)) {
      updateNotification(pendingNotice, {
        title: 'Ошибка отправки',
        message: error.message,
        type: 'error',
        duration: 6500,
      });
    } else {
      dismissNotification(pendingNotice);
    }
  } finally {
    printingKey.value = '';
  }
}

async function printLocalFile({ file, copies }) {
  printingLocalId.value = file.id;

  const pendingNotice = notify(
    `${file.name} · ${copies} шт.`,
    { title: 'Отправляем локальный файл', type: 'loading', duration: 0 }
  );

  try {
    const data = await request(`/api/webapp/local-files/${encodeURIComponent(file.id)}/print`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ copies }),
    });

    updateNotification(pendingNotice, {
      title: 'Задание отправлено',
      message: `${file.name} · #${data.job.id} · ${data.job.copies} шт.`,
      type: 'success',
      duration: 4200,
    });

    await Promise.all([loadAgent(), loadHistory()]);
  } catch (error) {
    if (!handleAuthError(error)) {
      updateNotification(pendingNotice, {
        title: 'Ошибка печати',
        message: error.message,
        type: 'error',
        duration: 6500,
      });
    } else {
      dismissNotification(pendingNotice);
    }
  } finally {
    printingLocalId.value = '';
  }
}

async function renameLocalFile({ id, name }) {
  renamingLocalId.value = id;
  try {
    const data = await request(`/api/webapp/local-files/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    const index = localFiles.value.findIndex(file => file.id === id);
    if (index >= 0) localFiles.value[index] = data.file;

    notify(data.file?.name || name, {
      title: 'Файл переименован',
      type: 'success',
      duration: 3000,
    });
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось переименовать файл',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    renamingLocalId.value = '';
  }
}

async function setLocalFavorite({ id, favorite }) {
  favoriteLocalId.value = id;

  try {
    const data = await request(`/api/webapp/local-files/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favorite: Boolean(favorite) }),
    });

    const index = localFiles.value.findIndex(file => file.id === id);
    if (index >= 0) localFiles.value[index] = data.file;

    notify(data.file?.name || 'PDF', {
      title: data.file?.favorite ? 'Добавлено в избранное' : 'Удалено из избранного',
      type: 'success',
      duration: 2400,
    });
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось изменить избранное',
        type: 'error',
        duration: 5000,
      });
    }
  } finally {
    favoriteLocalId.value = '';
  }
}


async function deleteLocalFile({ id, name }) {
  deletingLocalId.value = id;

  try {
    await request(`/api/webapp/local-files/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    localFiles.value = localFiles.value.filter(file => file.id !== id);

    notify(name || 'PDF', {
      title: 'Локальный файл удалён',
      type: 'success',
      duration: 3600,
    });
  } catch (error) {
    if (!handleAuthError(error)) {
      notify(error.message, {
        title: 'Не удалось удалить файл',
        type: 'error',
        duration: 6000,
      });
    }
  } finally {
    deletingLocalId.value = '';
  }
}

async function boot() {
  tg?.ready();
  tg?.expand();

  if (!tg || !initData) {
    await finishSplash();
    deny('Платформа удалённой печати PDF и этикеток через Telegram с управлением локальными файлами и печатным агентом.');
    return;
  }

  try {
    const data = await request('/api/webapp/me');
    user.value = data.user;
    applyAgent(data.agent, { announce: false });
    authStatus.value = 'ready';

    await Promise.all([
      loadPrintables(true),
      loadLocalFiles(),
      loadHistory(),
    ]);

    notify('PrintHub готов к работе.', {
      title: agentOnline.value ? 'Агент подключён' : 'Интерфейс загружен',
      type: agentOnline.value ? 'success' : 'warning',
      duration: 2800,
    });

    docsTimer = setInterval(() => loadPrintables(false), 20000);
    agentTimer = setInterval(loadAgent, 5000);
    historyTimer = setInterval(loadHistory, 7000);
  } catch (error) {
    handleAuthError(error) || deny('Не удалось открыть PrintHub. Попробуйте открыть Mini App заново.');
  } finally {
    await finishSplash();
  }
}

onMounted(boot);

onBeforeUnmount(() => {
  clearTimers();
  clearNotifications();
});
</script>

<template>
  <Transition name="splash" appear>
    <div v-if="splashVisible" class="tg-splash" role="status" aria-live="polite">
      <div class="tg-splash-card">
        <img :src="logoUrl" class="tg-splash-logo" alt="PrintHub" />
        <div class="tg-splash-title">PrintHub</div>
        <div class="tg-splash-subtitle">Подготавливаем печать…</div>
        <div class="tg-splash-loader" aria-hidden="true"></div>
      </div>
    </div>
  </Transition>

  <Transition name="page" mode="out-in" appear>
    <AuthGate
      v-if="authStatus !== 'ready'"
      key="auth"
      :status="authStatus"
      :message="authMessage"
      :logo-url="logoUrl"
    />

    <div v-else key="app" class="app-shell">
      <header class="app-header-motion">
        <div class="app-brand-heading">
          <img :src="logoUrl" class="app-brand-logo" alt="" aria-hidden="true" />
          <div>
            <div class="eyebrow">PRINT HUB</div>
            <h1>Печать этикеток</h1>
          </div>
        </div>

        <div class="header-agent-tools">
          <button
            class="status status-motion header-agent-status header-agent-status-button"
            :class="agentOnline ? 'online' : 'offline'"
            type="button"
            aria-label="Информация об агенте и принтере"
            title="Агент и принтер"
            @click="openAgentModal"
          >
            <span class="header-agent-dot" aria-hidden="true"></span>
            <span class="header-agent-label">{{ agentOnline ? 'Онлайн' : 'Офлайн' }}</span>
            <span class="header-agent-info-inline" aria-hidden="true"><FaIcon name="info" /></span>
          </button>
        </div>
      </header>

      <main>
        <TransitionGroup name="section" tag="div" class="main-sections" appear>
          <div key="manual" class="section-motion">
            <ManualUpload
              :busy="uploading"
              :local-count="localFiles.length"
              @submit="uploadManual"
              @save="saveManualLocal"
            >
              <template #library>
                <LocalFiles
                  :files="localFiles"
                  :loading="loadingLocalFiles"
                  :busy-id="printingLocalId"
                  :renaming-id="renamingLocalId"
                  :favorite-busy-id="favoriteLocalId"
                  :deleting-id="deletingLocalId"
                  @refresh="loadLocalFiles"
                  @print="printLocalFile"
                  @rename="renameLocalFile"
                  @favorite="setLocalFavorite"
                  @delete="deleteLocalFile"
                />
              </template>
            </ManualUpload>
          </div>

          <div key="marketplaces" class="section-motion">
            <PrintableList
              :documents="documents"
              :errors="errors"
              :loading="loadingDocs"
              :printing-key="printingKey"
              @refresh="loadPrintables(true)"
              @print="printDocument"
            />
          </div>

          <div key="service" class="section-motion bottom-accordions">
            <HistoryPanel
              :jobs="history"
              :loading="loadingHistory"
              @refresh="loadHistory"
            />
          </div>
        </TransitionGroup>
      </main>

      <AgentStatusModal
        :open="agentModalOpen"
        :agent="agent"
        :refreshing="refreshingAgent"
        @close="closeAgentModal"
        @refresh="loadAgent"
      />

      <NotificationStack
        :items="notifications"
        @dismiss="dismissNotification"
      />
    </div>
  </Transition>
</template>
