<script setup>
import FaIcon from './FaIcon.vue';

defineProps({
  items: { type: Array, default: () => [] },
});
const emit = defineEmits(['dismiss']);

</script>

<template>
  <Teleport to="body">
    <TransitionGroup
      name="notice"
      tag="div"
      class="notification-stack"
      aria-live="polite"
      aria-atomic="false"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="notification-card"
        :class="`notification-${item.type || 'info'}`"
        role="status"
      >
        <span class="notification-icon">
          <FaIcon
            :name="item.type === 'loading' ? 'refresh' : item.type === 'success' ? 'check' : 'info'"
            :spin="item.type === 'loading'"
          />
        </span>

        <div class="notification-copy">
          <strong v-if="item.title">{{ item.title }}</strong>
          <span>{{ item.message }}</span>
        </div>

        <button
          v-if="item.type !== 'loading'"
          class="notification-close"
          type="button"
          aria-label="Закрыть уведомление"
          @click="emit('dismiss', item.id)"
        >
          <FaIcon name="close" />
        </button>

        <span
          v-if="item.duration > 0"
          class="notification-progress"
          :style="{ animationDuration: `${item.duration}ms` }"
        ></span>
      </article>
    </TransitionGroup>
  </Teleport>
</template>
