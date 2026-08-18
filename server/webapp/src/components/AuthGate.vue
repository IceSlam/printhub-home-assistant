<script setup>
defineProps({
  status: { type: String, required: true },
  message: { type: String, default: '' },
  logoUrl: { type: String, default: '' },
});
</script>

<template>
  <div class="auth-gate" :class="{ denied: status === 'denied' }">
    <div class="auth-card">
      <img v-if="logoUrl" :src="logoUrl" class="auth-logo auth-logo-image" alt="PrintHub" />
      <div v-else class="auth-logo">PH</div>
      <h1>PrintHub</h1>
      <p>{{ message }}</p>
      <div v-if="status === 'checking'" class="spinner" />
    </div>
  </div>
</template>
