(function () {
  'use strict';

  const instances = new WeakMap();
  let serial = 0;

  function parseOptions(host) {
    try {
      const raw = JSON.parse(host.dataset.options || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.map(option => {
        if (typeof option === 'string' || typeof option === 'number') {
          return { value: String(option), label: String(option), disabled: false };
        }
        return {
          value: String(option?.value ?? ''),
          label: String(option?.label ?? option?.value ?? ''),
          disabled: Boolean(option?.disabled),
        };
      });
    } catch {
      return [];
    }
  }

  function svgChevron() {
    return '<svg class="app-select-chevron" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>';
  }

  function svgCheck() {
    return '<svg class="app-select-check" viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>';
  }

  class AppSelect {
    constructor(host) {
      this.host = host;
      this.options = parseOptions(host);
      this.value = String(host.dataset.value || '');
      this.inputId = host.dataset.id || '';
      this.name = host.dataset.name || '';
      this.label = host.dataset.label || '';
      this.disabled = host.dataset.disabled === '1';
      this.opened = false;
      this.activeIndex = -1;
      this.typeahead = '';
      this.typeaheadTimer = 0;
      this.menu = null;
      this.uid = `ph-app-select-${++serial}`;

      if (!this.options.some(item => item.value === this.value && !item.disabled)) {
        const first = this.options.find(item => !item.disabled);
        if (first && !this.value) this.value = first.value;
      }

      this.render();
      this.sync(false);
      instances.set(host, this);
      host.__printHubAppSelect = this;
      host.dataset.appSelectMounted = '1';
    }

    render() {
      this.host.classList.add('app-select-host-mounted');
      this.host.replaceChildren();

      this.root = document.createElement('div');
      this.root.className = 'app-select';

      if (this.name) {
        this.hidden = document.createElement('input');
        this.hidden.type = 'hidden';
        this.hidden.name = this.name;
        this.root.append(this.hidden);
      }

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'app-select-trigger';
      if (this.inputId) this.trigger.id = this.inputId;
      this.trigger.setAttribute('role', 'combobox');
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.setAttribute('aria-controls', `${this.uid}-listbox`);
      if (this.label) this.trigger.setAttribute('aria-label', this.label);
      this.trigger.disabled = this.disabled;

      this.valueNode = document.createElement('span');
      this.valueNode.className = 'app-select-value';
      this.trigger.append(this.valueNode);
      this.trigger.insertAdjacentHTML('beforeend', svgChevron());

      this.root.append(this.trigger);
      this.host.append(this.root);

      this.trigger.addEventListener('click', () => this.toggle());
      this.trigger.addEventListener('keydown', event => this.onKeydown(event));
    }

    currentOption() {
      return this.options.find(item => item.value === this.value)
        || this.options.find(item => !item.disabled)
        || null;
    }

    sync(emitChange) {
      const selected = this.currentOption();
      this.valueNode.textContent = selected?.label || 'Не выбрано';
      this.host.dataset.value = this.value;
      if (this.hidden) this.hidden.value = this.value;

      if (emitChange) {
        this.host.dispatchEvent(new CustomEvent('app-select-change', {
          bubbles: true,
          detail: { value: this.value },
        }));
      }
    }

    setValue(next, { emit = false, close = false } = {}) {
      const value = String(next ?? '');
      const option = this.options.find(item => item.value === value && !item.disabled);
      if (!option) return false;
      const changed = this.value !== option.value;
      this.value = option.value;
      this.sync(Boolean(emit && changed));
      if (close) this.close({ focus: true });
      if (this.opened) this.renderMenu();
      return true;
    }

    getValue() {
      return this.value;
    }

    toggle() {
      if (this.disabled) return;
      if (this.opened) this.close();
      else this.open();
    }

    open() {
      if (this.disabled || this.opened) return;
      AppSelect.closeOthers(this);
      this.opened = true;
      this.root.classList.add('is-open');
      this.trigger.setAttribute('aria-expanded', 'true');
      this.activeIndex = Math.max(0, this.options.findIndex(item => item.value === this.value));
      if (this.activeIndex < 0) this.activeIndex = this.options.findIndex(item => !item.disabled);
      this.renderMenu();
      this.positionMenu();

      this.onDocPointer = event => {
        if (this.host.contains(event.target) || this.menu?.contains(event.target)) return;
        this.close();
      };
      this.onViewport = () => this.positionMenu();
      document.addEventListener('pointerdown', this.onDocPointer, true);
      window.addEventListener('resize', this.onViewport, { passive: true });
      window.addEventListener('scroll', this.onViewport, true);
    }

    close({ focus = false } = {}) {
      if (!this.opened) return;
      this.opened = false;
      this.root.classList.remove('is-open');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.removeAttribute('aria-activedescendant');
      this.menu?.remove();
      this.menu = null;
      document.removeEventListener('pointerdown', this.onDocPointer, true);
      window.removeEventListener('resize', this.onViewport);
      window.removeEventListener('scroll', this.onViewport, true);
      if (focus) requestAnimationFrame(() => this.trigger.focus());
    }

    renderMenu() {
      this.menu?.remove();
      const menu = document.createElement('div');
      menu.id = `${this.uid}-listbox`;
      menu.className = 'app-select-menu';
      menu.setAttribute('role', 'listbox');
      if (this.label) menu.setAttribute('aria-label', this.label);
      menu.dataset.owner = this.uid;

      this.options.forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.id = `${this.uid}-option-${index}`;
        item.className = 'app-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', option.value === this.value ? 'true' : 'false');
        item.disabled = option.disabled;
        if (index === this.activeIndex) item.classList.add('is-active');
        if (option.value === this.value) item.classList.add('is-selected');

        const label = document.createElement('span');
        label.className = 'app-select-option-label';
        label.textContent = option.label;
        item.append(label);
        if (option.value === this.value) item.insertAdjacentHTML('beforeend', svgCheck());

        item.addEventListener('pointerenter', () => {
          if (option.disabled) return;
          this.activeIndex = index;
          this.refreshActiveState();
        });
        item.addEventListener('click', () => {
          if (option.disabled) return;
          this.value = option.value;
          this.sync(true);
          this.close({ focus: true });
        });
        menu.append(item);
      });

      document.body.append(menu);
      this.menu = menu;
      this.refreshActiveState();
    }

    refreshActiveState() {
      if (!this.menu) return;
      this.menu.querySelectorAll('.app-select-option').forEach((node, index) => {
        node.classList.toggle('is-active', index === this.activeIndex);
      });
      const active = this.menu.querySelector(`#${CSS.escape(`${this.uid}-option-${this.activeIndex}`)}`);
      if (active) {
        this.trigger.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    positionMenu() {
      if (!this.opened || !this.menu || !this.trigger.isConnected) return;
      const rect = this.trigger.getBoundingClientRect();
      const gap = 6;
      const edge = 10;
      const desired = Math.min(320, Math.max(92, this.options.length * 46 + 12));
      const below = window.innerHeight - rect.bottom - edge;
      const above = rect.top - edge;
      const openUp = below < Math.min(desired, 180) && above > below;
      const width = Math.min(Math.max(rect.width, 170), window.innerWidth - edge * 2);

      Object.assign(this.menu.style, {
        position: 'fixed',
        zIndex: '10000',
        left: `${Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge)}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(96, openUp ? above - gap : below - gap)}px`,
        top: openUp ? 'auto' : `${rect.bottom + gap}px`,
        bottom: openUp ? `${window.innerHeight - rect.top + gap}px` : 'auto',
      });
    }

    nextEnabled(start, direction) {
      if (!this.options.length) return -1;
      let index = start;
      for (let i = 0; i < this.options.length; i += 1) {
        index = (index + direction + this.options.length) % this.options.length;
        if (!this.options[index].disabled) return index;
      }
      return -1;
    }

    onKeydown(event) {
      if (this.disabled) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!this.opened) this.open();
        else {
          const next = this.nextEnabled(this.activeIndex, event.key === 'ArrowDown' ? 1 : -1);
          if (next >= 0) {
            this.activeIndex = next;
            this.refreshActiveState();
          }
        }
        return;
      }

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (!this.opened) this.open();
        const indexes = this.options.map((_, i) => i).filter(i => !this.options[i].disabled);
        this.activeIndex = event.key === 'Home' ? indexes[0] ?? -1 : indexes[indexes.length - 1] ?? -1;
        this.refreshActiveState();
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!this.opened) this.open();
        else if (this.activeIndex >= 0) {
          const option = this.options[this.activeIndex];
          if (option && !option.disabled) {
            this.value = option.value;
            this.sync(true);
            this.close({ focus: true });
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        if (this.opened) {
          event.preventDefault();
          this.close({ focus: true });
        }
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        this.typeahead += event.key.toLocaleLowerCase();
        clearTimeout(this.typeaheadTimer);
        this.typeaheadTimer = setTimeout(() => { this.typeahead = ''; }, 650);
        const found = this.options.findIndex(item => !item.disabled && item.label.toLocaleLowerCase().startsWith(this.typeahead));
        if (found >= 0) {
          if (!this.opened) this.open();
          this.activeIndex = found;
          this.refreshActiveState();
        }
      }
    }

    destroy() {
      this.close();
      clearTimeout(this.typeaheadTimer);
      delete this.host.__printHubAppSelect;
      delete this.host.dataset.appSelectMounted;
      instances.delete(this.host);
    }

    static closeOthers(current) {
      document.querySelectorAll('[data-app-select][data-app-select-mounted="1"]').forEach(host => {
        const instance = instances.get(host);
        if (instance && instance !== current) instance.close();
      });
    }
  }

  function mountOne(host) {
    if (!(host instanceof Element) || !host.matches('[data-app-select]')) return null;
    const existing = instances.get(host);
    if (existing) return existing;
    return new AppSelect(host);
  }

  function mountAll(root = document) {
    if (root instanceof Element && root.matches('[data-app-select]')) mountOne(root);
    root.querySelectorAll?.('[data-app-select]').forEach(mountOne);
  }

  function getInstance(target) {
    if (!target) return null;
    if (target instanceof Element) {
      const host = target.matches('[data-app-select]') ? target : target.closest?.('[data-app-select]');
      return host ? instances.get(host) || mountOne(host) : null;
    }
    const id = String(target).replace(/^#/, '');
    const host = document.getElementById(`${id}-host`) || document.getElementById(id)?.closest?.('[data-app-select]');
    return host ? instances.get(host) || mountOne(host) : null;
  }

  function getValue(target) {
    return getInstance(target)?.getValue() ?? '';
  }

  function setValue(target, value, options = {}) {
    return getInstance(target)?.setValue(value, options) ?? false;
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        mountAll(node);
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('[data-app-select]')) instances.get(node)?.destroy();
        node.querySelectorAll?.('[data-app-select]').forEach(host => instances.get(host)?.destroy());
      }
    }
  });

  window.PrintHubAppSelect = { mountAll, mountOne, getValue, setValue, getInstance };

  const start = () => {
    mountAll(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.dispatchEvent(new CustomEvent('printhub-app-select-ready'));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
