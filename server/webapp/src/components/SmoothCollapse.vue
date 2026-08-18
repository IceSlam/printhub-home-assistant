<script setup>
defineProps({
  open: Boolean,
});

const TRANSITION_MS = 380;

function setOpenState(el) {
  el.style.height = 'auto';
  el.style.opacity = '1';
  el.style.transform = 'translate3d(0,0,0)';
  el.style.removeProperty('will-change');
}

function setClosedState(el) {
  el.style.height = '0px';
  el.style.opacity = '0';
  el.style.transform = 'translate3d(0,-6px,0)';
}

function beforeEnter(el) {
  setClosedState(el);
  el.style.willChange = 'height, opacity, transform';
}

function enter(el, done) {
  // Force the collapsed style to be committed before measuring/opening.
  void el.offsetHeight;

  const targetHeight = el.scrollHeight;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener('transitionend', onTransitionEnd);
    done();
  };

  const onTransitionEnd = event => {
    if (event.target === el && event.propertyName === 'height') {
      finish();
    }
  };

  el.addEventListener('transitionend', onTransitionEnd);

  requestAnimationFrame(() => {
    el.style.height = `${targetHeight}px`;
    el.style.opacity = '1';
    el.style.transform = 'translate3d(0,0,0)';
  });

  // Defensive fallback for WebViews that occasionally fail to dispatch
  // transitionend after a rapid Telegram viewport resize.
  window.setTimeout(finish, TRANSITION_MS + 100);
}

function afterEnter(el) {
  // Critical: keep the element visibly open. Do not remove opacity/transform
  // here because the base CSS represents the visible/open state.
  setOpenState(el);
}

function enterCancelled(el) {
  setOpenState(el);
}

function beforeLeave(el) {
  const currentHeight = el.getBoundingClientRect().height || el.scrollHeight;

  el.style.height = `${currentHeight}px`;
  el.style.opacity = '1';
  el.style.transform = 'translate3d(0,0,0)';
  el.style.willChange = 'height, opacity, transform';

  // Commit the real current height before moving to zero.
  void el.offsetHeight;
}

function leave(el, done) {
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener('transitionend', onTransitionEnd);
    done();
  };

  const onTransitionEnd = event => {
    if (event.target === el && event.propertyName === 'height') {
      finish();
    }
  };

  el.addEventListener('transitionend', onTransitionEnd);

  requestAnimationFrame(() => {
    setClosedState(el);
  });

  window.setTimeout(finish, TRANSITION_MS + 100);
}

function afterLeave(el) {
  setClosedState(el);
  el.style.removeProperty('will-change');
}

function leaveCancelled(el) {
  setOpenState(el);
}
</script>

<template>
  <Transition
    :css="false"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @enter-cancelled="enterCancelled"
    @before-leave="beforeLeave"
    @leave="leave"
    @after-leave="afterLeave"
    @leave-cancelled="leaveCancelled"
  >
    <div v-if="open" class="smooth-collapse">
      <div class="smooth-collapse-inner">
        <slot />
      </div>
    </div>
  </Transition>
</template>
