<script setup>
import { computed, ref } from 'vue';
import FaIcon from './FaIcon.vue';

const props = defineProps({
  documents: { type: Array, default: () => [] },
  errors: { type: Array, default: () => [] },
  loading: Boolean,
  printingKey: String,
});

const emit = defineEmits(['refresh','print']);
const filter = ref('all');

const filtered = computed(() =>
  filter.value === 'all'
    ? props.documents
    : props.documents.filter(doc => doc.marketplace === filter.value)
);

const marketplaceName = mp =>
  mp === 'ozon' ? 'Ozon' :
  mp === 'wb' ? 'WB' :
  'Яндекс';

const marketplaceCode = mp =>
  mp === 'ozon' ? 'OZON' :
  mp === 'wb' ? 'WB' :
  'YM';

const marketplaceErrorName = mp =>
  mp === 'ozon' ? 'Ozon' :
  mp === 'wb' ? 'Wildberries' :
  mp === 'yandex' ? 'Яндекс Маркет' :
  mp;

const deliveryBadge = doc => {
  if (doc.marketplace === 'ozon' || doc.marketplace === 'wb') return 'FBS';
  if (doc.marketplace === 'yandex') return 'FBS / DBS';
  return 'Этикетка';
};

const documentType = doc =>
  doc.kind === 'shipment-label' ? 'Этикетка отправления' : (doc.title || 'Печатный документ');

const sizeLabel = doc => `${String(doc.size || 'auto').replace('x','×')} мм`;

function setFilter(value) {
  filter.value = value;
}
</script>

<template>
  <section class="printable-section">
    <div class="head">
      <div>
        <h2>Доступно для печати</h2>
        <p>Только печатные документы из отгрузок, без списка заказов.</p>
      </div>

      <button
        class="icon refresh-button"
        type="button"
        :class="{ 'is-loading': loading }"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <FaIcon name="refresh" :spin="loading" />
      </button>
    </div>

    <div class="filters">
      <button
        v-for="item in [['all','Все'],['ozon','Ozon'],['wb','WB'],['yandex','Яндекс']]"
        :key="item[0]"
        type="button"
        :class="{ active: filter === item[0] }"
        @click="setFilter(item[0])"
      >
        {{ item[1] }}
      </button>
    </div>

    <TransitionGroup name="error-row" tag="div" class="marketplace-errors">
      <div
        v-for="error in errors"
        :key="error.marketplace"
        class="error"
      >
        {{ marketplaceErrorName(error.marketplace) }}: {{ error.error }}
      </div>
    </TransitionGroup>

    <TransitionGroup name="document" tag="div" class="docs marketplace-card-list">
      <div
        v-if="loading && !documents.length"
        key="loading"
        class="empty empty-motion"
      >
        <span class="inline-spinner"></span>
        Обновление…
      </div>

      <div
        v-else-if="!filtered.length"
        :key="`empty-${filter}`"
        class="empty empty-motion"
      >
        Сейчас нет доступных файлов для печати.
      </div>

      <article
        v-for="doc in filtered"
        :key="doc.key"
        class="doc marketplace-print-card"
        :class="`marketplace-${doc.marketplace}`"
      >
        <div class="marketplace-label-preview" aria-hidden="true">
          <div class="marketplace-label-sheet">
            <strong>{{ marketplaceCode(doc.marketplace) }}</strong>
            <span>{{ deliveryBadge(doc) }}</span>
            <i class="marketplace-label-barcode"></i>
            <small>{{ String(doc.size).replace('x',' × ') }}</small>
          </div>
        </div>

        <div class="doc-body marketplace-print-card-body">
          <div class="marketplace-card-badges">
            <span class="marketplace-pill marketplace-pill-primary">{{ marketplaceName(doc.marketplace) }}</span>
            <span class="marketplace-pill">{{ deliveryBadge(doc) }}</span>
          </div>

          <h3 :title="doc.itemName || doc.title">{{ doc.itemName || doc.title }}</h3>
          <strong v-if="doc.quantityText" class="marketplace-quantity">{{ doc.quantityText }}</strong>

          <div class="marketplace-meta">
            <span>{{ documentType(doc) }}</span>
            <span v-if="doc.remoteId">Отправление: {{ doc.remoteId }}</span>
          </div>
        </div>

        <div class="marketplace-card-footer">
          <span class="marketplace-size-pill"><FaIcon name="printer" />{{ sizeLabel(doc) }}</span>

          <button
            class="print marketplace-print-button"
            type="button"
            :disabled="printingKey === doc.key"
            :class="{ 'is-sending': printingKey === doc.key }"
            @click="emit('print', doc)"
          >
            <span v-if="printingKey === doc.key" class="button-spinner"></span>
            <FaIcon v-else name="printer" />
            <span>{{ printingKey === doc.key ? 'Печать…' : 'Печать' }}</span>
          </button>
        </div>
      </article>
    </TransitionGroup>
  </section>
</template>
