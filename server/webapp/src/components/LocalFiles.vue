<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import SmoothCollapse from './SmoothCollapse.vue';
import CopyStepper from './CopyStepper.vue';
import FaIcon from './FaIcon.vue';
import { lockModalScroll, unlockModalScroll } from '../utils/modalScrollLock.js';
import { usePrintHubApi } from '../composables/usePrintHubApi.js';

const props = defineProps({
  files: { type: Array, default: () => [] },
  loading: Boolean,
  busyId: { type: String, default: '' },
  renamingId: { type: String, default: '' },
  favoriteBusyId: { type: String, default: '' },
  deletingId: { type: String, default: '' },
});

const emit = defineEmits(['refresh', 'print', 'rename', 'favorite', 'delete']);
const { requestBlob } = usePrintHubApi();

const copies = reactive({});
const editingId = ref('');
const editName = ref('');
const expanded = ref(false);
const searchQuery = ref('');
const favoritesOnly = ref(false);

const thumbnailUrls = reactive({});
const thumbnailLoading = reactive({});
const thumbnailErrors = reactive({});

const previewOpen = ref(false);
const previewFile = ref(null);
const previewPage = ref(1);
const previewUrl = ref('');
const previewLoading = ref(false);
const previewError = ref('');
const previewCopies = ref(1);
const deleteConfirm = ref(false);
const previewLock = Symbol('local-file-preview');

const fileCountLabel = computed(() => {
  const count = props.files.length;
  if (!count) return 'Сохранённых PDF пока нет';
  return `Сохранено файлов: ${count}`;
});

const favoriteCount = computed(() => props.files.filter(file => Boolean(file.favorite)).length);

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase('ru-RU'));

const visibleFiles = computed(() => {
  const query = normalizedSearchQuery.value;

  return props.files
    .filter(file => {
      if (favoritesOnly.value && !file.favorite) return false;
      if (!query) return true;

      const haystack = [
        file.name,
        file.originalFilename,
        profileLabel(file.profile),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru-RU');

      return haystack.includes(query);
    })
    .slice()
    .sort((a, b) => {
      const favoriteDelta = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
      if (favoriteDelta) return favoriteDelta;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
});

const searchResultLabel = computed(() => {
  if (!searchQuery.value.trim() && !favoritesOnly.value) return '';
  return `Найдено: ${visibleFiles.value.length} из ${props.files.length}`;
});

function clearSearch() {
  searchQuery.value = '';
}

function toggleFavorite(file) {
  if (!file?.id) return;
  emit('favorite', { id: file.id, favorite: !Boolean(file.favorite) });
}

function copyCount(id) {
  return copies[id] || 1;
}

function setCopies(id, value) {
  const n = Math.trunc(Number(value || 1));
  copies[id] = Math.min(99, Math.max(1, Number.isFinite(n) ? n : 1));
}

function setPreviewCopies(value) {
  const n = Math.trunc(Number(value || 1));
  previewCopies.value = Math.min(99, Math.max(1, Number.isFinite(n) ? n : 1));
}

function startRename(file) {
  editingId.value = file.id;
  editName.value = file.name;
}

function cancelRename() {
  editingId.value = '';
  editName.value = '';
}

function saveRename(file) {
  const name = editName.value.trim();
  if (!name) return;
  emit('rename', { id: file.id, name });
  editingId.value = '';
  editName.value = '';
}

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  const value = Number(bytes);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function profileLabel(profile) {
  return String(profile || 'auto').replace('x', '×');
}

function releaseUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

async function loadThumbnail(file) {
  if (!file?.id || thumbnailUrls[file.id] || thumbnailLoading[file.id]) return;

  thumbnailLoading[file.id] = true;
  thumbnailErrors[file.id] = '';

  try {
    const blob = await requestBlob(
      `/api/webapp/local-files/${encodeURIComponent(file.id)}/preview?page=1&size=thumb`
    );
    thumbnailUrls[file.id] = URL.createObjectURL(blob);
  } catch (error) {
    thumbnailErrors[file.id] = error.message || 'Предпросмотр недоступен';
  } finally {
    thumbnailLoading[file.id] = false;
  }
}

async function loadVisibleThumbnails() {
  if (!expanded.value) return;
  await Promise.allSettled(visibleFiles.value.map(loadThumbnail));
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) loadVisibleThumbnails();
}

async function openPreview(file) {
  previewFile.value = file;
  previewPage.value = 1;
  previewCopies.value = copyCount(file.id);
  deleteConfirm.value = false;
  lockModalScroll(previewLock);
  previewOpen.value = true;
  await loadFullPreview();
}

function closePreview() {
  // Do not clear previewFile/previewUrl here. Vue must keep the complete
  // dialog geometry until the leave transition has finished.
  previewOpen.value = false;
}

function afterPreviewLeave() {
  previewFile.value = null;
  previewError.value = '';
  previewLoading.value = false;
  deleteConfirm.value = false;
  releaseUrl(previewUrl.value);
  previewUrl.value = '';
  unlockModalScroll(previewLock);
}

async function loadFullPreview() {
  if (!previewFile.value) return;

  previewLoading.value = true;
  previewError.value = '';
  releaseUrl(previewUrl.value);
  previewUrl.value = '';

  try {
    const blob = await requestBlob(
      `/api/webapp/local-files/${encodeURIComponent(previewFile.value.id)}/preview` +
      `?page=${previewPage.value}&size=full`
    );
    previewUrl.value = URL.createObjectURL(blob);
  } catch (error) {
    previewError.value = error.message || 'Не удалось открыть страницу';
  } finally {
    previewLoading.value = false;
  }
}

async function changePage(delta) {
  const total = Number(previewFile.value?.pageCount || 1);
  const next = Math.min(total, Math.max(1, previewPage.value + delta));
  if (next === previewPage.value) return;
  previewPage.value = next;
  await loadFullPreview();
}

function printFromPreview() {
  if (!previewFile.value) return;
  copies[previewFile.value.id] = previewCopies.value;
  emit('print', {
    file: previewFile.value,
    copies: previewCopies.value,
  });
}

function askDeletePreview() {
  if (!previewFile.value) return;
  deleteConfirm.value = true;
}

function cancelDeletePreview() {
  deleteConfirm.value = false;
}

function confirmDeletePreview() {
  if (!previewFile.value || props.deletingId === previewFile.value.id) return;

  emit('delete', {
    id: previewFile.value.id,
    name: previewFile.value.name,
  });
}

watch(
  () => visibleFiles.value.map(file => `${file.id}:${file.favorite ? 1 : 0}`).join(','),
  () => {
    if (expanded.value) loadVisibleThumbnails();
  }
);

watch(
  () => props.files.map(file => `${file.id}:${file.favorite ? 1 : 0}:${file.updatedAt || ''}`).join(','),
  () => {
    const ids = new Set(props.files.map(file => file.id));

    for (const [id, url] of Object.entries(thumbnailUrls)) {
      if (ids.has(id)) continue;
      releaseUrl(url);
      delete thumbnailUrls[id];
      delete thumbnailLoading[id];
      delete thumbnailErrors[id];
      delete copies[id];
    }

    if (!previewFile.value?.id) return;

    const updated = props.files.find(file => file.id === previewFile.value.id);
    if (updated) {
      previewFile.value = updated;
      return;
    }

    // File has been deleted successfully by the parent. Close the preview
    // through the normal leave animation instead of tearing it down.
    deleteConfirm.value = false;
    closePreview();
  }
);

onBeforeUnmount(() => {
  Object.values(thumbnailUrls).forEach(releaseUrl);
  releaseUrl(previewUrl.value);
  unlockModalScroll(previewLock);
});
</script>

<template>
  <section class="agent-accordion local-files-accordion" :class="{ 'is-open': expanded }">
    <button class="accordion-summary" type="button" :aria-expanded="expanded" @click="toggleExpanded">
      <span class="accordion-summary-copy">
        <strong>Локально загруженные</strong>
        <span>{{ fileCountLabel }}</span>
      </span>
      <span class="accordion-chevron"><FaIcon name="chevronDown" /></span>
    </button>

    <SmoothCollapse :open="expanded">
      <div class="agent-content local-files-content">
      <div class="accordion-toolbar local-library-toolbar">
        <span>Сохранённые PDF для повторной печати</span>

        <div class="library-toolbar-actions">
          <button
            class="mini-refresh"
            type="button"
            :disabled="loading"
            aria-label="Обновить локальные файлы"
            @click.prevent="emit('refresh')"
          >
            <span v-if="loading" class="button-spinner"></span><FaIcon v-else name="refresh" />
          </button>
        </div>
      </div>

      <div class="local-library-searchbar">
        <label class="local-search-box">
          <span class="local-search-icon" aria-hidden="true"><FaIcon name="search" /></span>
          <input
            v-model="searchQuery"
            type="search"
            autocomplete="off"
            enterkeyhint="search"
            placeholder="Поиск по локальным PDF"
            aria-label="Поиск по локальным PDF"
          />
          <button
            v-if="searchQuery"
            class="local-search-clear"
            type="button"
            aria-label="Очистить поиск"
            @click="clearSearch"
          >
            <FaIcon name="close" />
          </button>
        </label>

        <button
          class="favorites-filter-button"
          :class="{ active: favoritesOnly }"
          type="button"
          :aria-pressed="favoritesOnly"
          @click="favoritesOnly = !favoritesOnly"
        >
          <span aria-hidden="true">★</span>
          <span>{{ favoriteCount }}</span>
        </button>
      </div>

      <Transition name="search-meta">
        <div v-if="searchResultLabel" class="local-search-meta">
          {{ searchResultLabel }}
        </div>
      </Transition>

      <div v-if="loading && !files.length" class="empty compact-empty">
        Загрузка…
      </div>

      <div v-else-if="!files.length" class="empty compact-empty">
        Сохранённых файлов пока нет. При ручной загрузке включите
        «Сохранить в локальные».
      </div>

      <div v-else-if="!visibleFiles.length" class="empty compact-empty local-search-empty">
        <strong>{{ favoritesOnly ? 'В избранном ничего не найдено' : 'Файлы не найдены' }}</strong>
        <span>Попробуйте изменить запрос или отключить фильтр избранного.</span>
        <button
          v-if="searchQuery || favoritesOnly"
          class="text-button"
          type="button"
          @click="searchQuery = ''; favoritesOnly = false"
        >
          Сбросить фильтры
        </button>
      </div>

      <div v-else class="local-gallery">
        <article
          v-for="file in visibleFiles"
          :key="file.id"
          class="gallery-card"
        >
          <div class="gallery-preview-column">
            <div class="gallery-preview-wrap">
            <button
              class="gallery-preview-button"
              type="button"
              :aria-label="`Открыть ${file.name}`"
              @click="openPreview(file)"
            >
              <img
                v-if="thumbnailUrls[file.id]"
                :src="thumbnailUrls[file.id]"
                :alt="`Предпросмотр ${file.name}`"
                class="gallery-thumb"
              />

              <div v-else class="gallery-thumb-placeholder">
                <span v-if="thumbnailLoading[file.id]" class="gallery-spinner"></span>
                <template v-else-if="thumbnailErrors[file.id]">
                  <strong>PDF</strong>
                  <small>Превью недоступно</small>
                </template>
                <template v-else>
                  <strong>PDF</strong>
                  <small>Открыть</small>
                </template>
              </div>

            </button>
            </div>

            <span class="local-size-pill local-preview-size-pill">
              <FaIcon name="printer" />{{ profileLabel(file.profile) }} мм
            </span>
          </div>

          <div class="gallery-card-body local-modern-card-body">
            <template v-if="editingId === file.id">
              <input
                v-model="editName"
                class="rename-input"
                type="text"
                maxlength="140"
                @keyup.enter="saveRename(file)"
                @keyup.esc="cancelRename"
              />
              <div class="rename-actions">
                <button
                  class="text-button"
                  type="button"
                  :disabled="renamingId === file.id"
                  @click="saveRename(file)"
                >
                  {{ renamingId === file.id ? 'Сохранение…' : 'Сохранить' }}
                </button>
                <button
                  class="text-button muted-button"
                  type="button"
                  @click="cancelRename"
                >
                  Отмена
                </button>
              </div>
            </template>

            <template v-else>
              <div class="local-modern-card-head">
                <div class="local-card-badges">
                  <span class="local-file-pill local-file-pill-primary">Локальный PDF</span>
                </div>

                <div class="local-title-actions local-modern-actions">
                  <button
                    class="favorite-button favorite-button-list"
                    :class="{ active: file.favorite }"
                    type="button"
                    :disabled="favoriteBusyId === file.id"
                    :aria-label="file.favorite ? 'Убрать из избранного' : 'Добавить в избранное'"
                    :aria-pressed="Boolean(file.favorite)"
                    :title="file.favorite ? 'Убрать из избранного' : 'В избранное'"
                    @click="toggleFavorite(file)"
                  >
                    {{ file.favorite ? '★' : '☆' }}
                  </button>
                  <button
                    class="gallery-edit list-edit-button"
                    type="button"
                    aria-label="Переименовать файл"
                    title="Переименовать"
                    @click="startRename(file)"
                  >
                    <FaIcon name="edit" />
                  </button>
                </div>
              </div>

              <div class="gallery-title-row local-modern-title-row">
                <h3 :title="file.name">{{ file.name }}</h3>
              </div>

              <div class="local-modern-meta">
                <span>{{ formatSize(file.sizeBytes) }}</span>
                <span>{{ Number(file.pageCount || 1) }} стр.</span>
              </div>
            </template>
          </div>
        </article>
      </div>

      </div>
    </SmoothCollapse>
  </section>

  <Teleport to="body">
    <Transition name="preview-modal" @after-leave="afterPreviewLeave">
      <div v-if="previewOpen" class="pdf-preview-overlay" @click.self="closePreview">
        <section class="pdf-preview-dialog" role="dialog" aria-modal="true" aria-label="Предпросмотр PDF">
          <header class="pdf-preview-header">
            <div>
              <strong>{{ previewFile?.name }}</strong>
              <span>
                {{ profileLabel(previewFile?.profile) }} ·
                {{ formatSize(previewFile?.sizeBytes) }}
              </span>
            </div>
            <div class="preview-header-actions">
              <button
                v-if="previewFile"
                class="favorite-button preview-favorite-button"
                :class="{ active: previewFile.favorite }"
                type="button"
                :disabled="favoriteBusyId === previewFile.id"
                :aria-label="previewFile.favorite ? 'Убрать из избранного' : 'Добавить в избранное'"
                :aria-pressed="Boolean(previewFile.favorite)"
                @click="toggleFavorite(previewFile)"
              >
                {{ previewFile.favorite ? '★' : '☆' }}
              </button>
              <button class="preview-close" type="button" aria-label="Закрыть" @click="closePreview"><FaIcon name="close" /></button>
            </div>
          </header>

          <div class="pdf-preview-stage">
            <div v-if="previewLoading" class="preview-loading">
              <span class="gallery-spinner"></span>
              <span>Готовим страницу…</span>
            </div>

            <div v-else-if="previewError" class="preview-error">
              <strong>Не удалось показать страницу</strong>
              <span>{{ previewError }}</span>
              <button class="secondary action-with-icon" type="button" @click="loadFullPreview"><FaIcon name="refresh" />Повторить</button>
            </div>

            <img
              v-else-if="previewUrl"
              :src="previewUrl"
              :alt="`Страница ${previewPage} файла ${previewFile?.name}`"
              class="full-preview-image"
            />
          </div>

          <div
            v-if="Number(previewFile?.pageCount || 1) > 1"
            class="preview-pagination"
          >
            <button
              type="button"
              :disabled="previewPage <= 1 || previewLoading"
              @click="changePage(-1)"
            >
              ‹
            </button>
            <span>{{ previewPage }} / {{ previewFile?.pageCount }}</span>
            <button
              type="button"
              :disabled="previewPage >= Number(previewFile?.pageCount || 1) || previewLoading"
              @click="changePage(1)"
            >
              ›
            </button>
          </div>

          <footer class="pdf-preview-footer">
            <CopyStepper
              :model-value="previewCopies"
              label="Количество копий"
              @update:model-value="setPreviewCopies"
            />

            <button
              class="primary"
              type="button"
              :disabled="busyId === previewFile?.id"
              @click="printFromPreview"
            >
              <FaIcon name="printer" /><span>{{ busyId === previewFile?.id ? 'Отправка…' : `Печатать файл · ${previewCopies} шт.` }}</span>
            </button>

            <Transition name="delete-confirm">
              <div v-if="deleteConfirm" class="preview-delete-confirm">
                <div class="preview-delete-confirm-copy">
                  <strong>Удалить локальный PDF?</strong>
                  <span>
                    Файл «{{ previewFile?.name }}» будет удалён из локального хранилища.
                    История уже выполненной печати останется.
                  </span>
                </div>

                <div class="preview-delete-confirm-actions">
                  <button
                    class="secondary"
                    type="button"
                    :disabled="deletingId === previewFile?.id"
                    @click="cancelDeletePreview"
                  >
                    Отмена
                  </button>

                  <button
                    class="danger-button"
                    type="button"
                    :disabled="deletingId === previewFile?.id"
                    @click="confirmDeletePreview"
                  >
                    <FaIcon name="trash" /><span>{{ deletingId === previewFile?.id ? 'Удаление…' : 'Удалить' }}</span>
                  </button>
                </div>
              </div>
            </Transition>

            <button
              v-if="!deleteConfirm"
              class="preview-delete-button"
              type="button"
              :disabled="deletingId === previewFile?.id"
              @click="askDeletePreview"
            >
              <FaIcon name="trash" />
              <span>Удалить локальный файл</span>
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
