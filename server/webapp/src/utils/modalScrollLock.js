const locks = new Set();

let saved = null;

function applyLock() {
  if (saved || typeof document === 'undefined') return;

  const body = document.body;
  const root = document.documentElement;
  const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);

  saved = {
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
    bodyPaddingRight: body.style.paddingRight,
    rootOverflow: root.style.overflow,
    rootOverscrollBehavior: root.style.overscrollBehavior,
  };

  body.classList.add('printhub-modal-open');

  // Never convert the whole page to position:fixed. In Telegram/iOS the
  // subsequent top restoration is visible as a jump after a modal closes.
  body.style.overflow = 'hidden';
  root.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';
  root.style.overscrollBehavior = 'none';

  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
}

function releaseLock() {
  if (!saved || typeof document === 'undefined') return;

  const body = document.body;
  const root = document.documentElement;
  const state = saved;
  saved = null;

  body.classList.remove('printhub-modal-open');

  body.style.overflow = state.bodyOverflow;
  body.style.overscrollBehavior = state.bodyOverscrollBehavior;
  body.style.paddingRight = state.bodyPaddingRight;
  root.style.overflow = state.rootOverflow;
  root.style.overscrollBehavior = state.rootOverscrollBehavior;
}

export function lockModalScroll(token) {
  locks.add(token);
  if (locks.size === 1) applyLock();
}

export function unlockModalScroll(token) {
  locks.delete(token);
  if (locks.size === 0) releaseLock();
}

export function forceUnlockModalScroll(token) {
  locks.delete(token);
  if (locks.size === 0) releaseLock();
}
