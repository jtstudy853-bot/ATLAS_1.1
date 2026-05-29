/* ═══════════════════════════════════════════════════════════════
   ALTAS — UI.JS
   Custom cursor · Ambient effects · Particles · Toast system
   Boot animations · Micro-interactions · All visual polish
   Must load FIRST — no dependencies
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   1. CURSOR SYSTEM
   Exact logic from cursor_type_simulator_v4.html, adapted to
   run globally across the entire ALTAS app (not just a canvas).
   States: default · link · loading · blocked · text ·
           grab · resize · zoom · thinking · click
   ───────────────────────────────────────────────────────────── */

const ALTASCursor = (() => {

  /* DOM refs — all grabbed once */
  let cursorEl       = null;
  let dot            = null;
  let ring           = null;
  let ibeam          = null;
  let zoomEl         = null;
  let thinkingEl     = null;
  let labelEl        = null;

  /* Mouse position — exact */
  let mx = 0, my = 0;

  /* Ring lerp position — lags behind */
  let rx = 0, ry = 0;

  /* Current state */
  let currentState  = 'default';
  let isVisible     = false;
  let rafId         = null;

  /* Spin state for loading ring */
  let spinAngle     = 0;
  let spinRafId     = null;

  /* Is touch device — skip everything */
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  /* ── State configuration map ──
     Mirrors configs from cursor_type_simulator_v4.html
     extended with ALTAS-specific states               */
  const STATE_CONFIGS = {

    default: {
      dot:   { show: true,  size: 7,  color: '#7B6CFF' },
      ring:  { show: true,  size: 28, w: null, h: null,
               color: 'rgba(123,108,255,0.55)',
               radius: '50%', bg: 'transparent',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: false, label: '',
      lag: 0.13
    },

    link: {
      dot:   { show: true,  size: 7,  color: '#7B6CFF' },
      ring:  { show: true,  size: 34, w: null, h: null,
               color: 'rgba(123,108,255,0.95)',
               radius: '50%', bg: 'rgba(123,108,255,0.04)',
               glow: '0 0 10px 3px rgba(123,108,255,0.45), 0 0 22px 6px rgba(123,108,255,0.2)',
               spin: false },
      ibeam: false, zoom: false, thinking: false, label: '',
      lag: 0.13
    },

    loading: {
      dot:   { show: true,  size: 5,  color: '#7B6CFF' },
      ring:  { show: true,  size: 32, w: null, h: null,
               color: 'rgba(123,108,255,0.7)',
               radius: '50%', bg: 'transparent',
               glow: 'none', spin: true },
      ibeam: false, zoom: false, thinking: false, label: '',
      lag: 0.08
    },

    blocked: {
      dot:   { show: true,  size: 7,  color: '#FF5050' },
      ring:  { show: true,  size: 30, w: null, h: null,
               color: 'rgba(255,80,80,0.7)',
               radius: '50%', bg: 'rgba(255,80,80,0.06)',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: false, label: '✕',
      lag: 0.13
    },

    text: {
      dot:   { show: true,  size: 4,  color: '#7B6CFF' },
      ring:  { show: true,  size: 0, w: 26, h: 36,
               color: 'rgba(123,108,255,0.45)',
               radius: '50%', bg: 'rgba(123,108,255,0.05)',
               glow: 'none', spin: false },
      ibeam: true, zoom: false, thinking: false, label: '',
      lag: 0.13
    },

    grab: {
      dot:   { show: true,  size: 8,  color: '#FFB43C' },
      ring:  { show: true,  size: 36, w: null, h: null,
               color: 'rgba(255,180,60,0.6)',
               radius: '50%', bg: 'rgba(255,180,60,0.05)',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: false, label: '⊕',
      lag: 0.13
    },

    resize: {
      dot:   { show: true,  size: 5,  color: '#C88CFF' },
      ring:  { show: true,  size: 26, w: null, h: null,
               color: 'rgba(200,140,255,0.7)',
               radius: '3px', bg: 'transparent',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: false, label: '↔',
      lag: 0.13
    },

    zoom: {
      dot:   { show: false, size: 7,  color: '#7B6CFF' },
      ring:  { show: true,  size: 34, w: null, h: null,
               color: 'rgba(123,108,255,0.55)',
               radius: '50%', bg: 'transparent',
               glow: 'none', spin: false },
      ibeam: false, zoom: true, thinking: false, label: '',
      lag: 0.13
    },

    /* ALTAS-specific: AI is streaming a response */
    thinking: {
      dot:   { show: false, size: 7,  color: '#7B6CFF' },
      ring:  { show: false, size: 28, w: null, h: null,
               color: 'rgba(123,108,255,0.55)',
               radius: '50%', bg: 'transparent',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: true, label: '',
      lag: 0.08
    },

    /* Transient: on mousedown flash */
    click: {
      dot:   { show: true,  size: 5,  color: '#C4BFFF' },
      ring:  { show: true,  size: 22, w: null, h: null,
               color: 'rgba(123,108,255,0.9)',
               radius: '50%', bg: 'transparent',
               glow: 'none', spin: false },
      ibeam: false, zoom: false, thinking: false, label: '',
      lag: 0.13
    }
  };

  /* ── Infer cursor state from a DOM element ── */
  function inferState(el) {
    if (!el) return 'default';

    /* Explicit override wins */
    const explicit = el.closest('[data-cursor]');
    if (explicit) return explicit.dataset.cursor;

    /* Disabled → blocked */
    const nearest = el.closest('button, a, input, textarea, select, [role="button"], [role="listitem"], [tabindex]');
    if (nearest) {
      if (nearest.disabled || nearest.getAttribute('aria-disabled') === 'true') return 'blocked';
      if (nearest.tagName === 'INPUT' || nearest.tagName === 'TEXTAREA') return 'text';
      if (nearest.getAttribute('data-draggable') === 'true') return 'grab';
      if (nearest.tagName === 'A' || nearest.tagName === 'BUTTON' ||
          nearest.getAttribute('role') === 'button') return 'link';
    }

    /* Inputs not caught above */
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
        el.isContentEditable) return 'text';

    /* Chip / clickable list item */
    if (el.closest('.chip, .capability-item, .conv-item, .btn-new-chat,
                    .header-btn, .icon-btn, .msg-action-btn, .btn-code-copy,
                    .overlay-close, .settings-save-btn, .header-mode-btn,
                    .sidebar-collapse-btn, .sidebar-toggle, .btn-send.active')) {
      const target = el.closest('[disabled], [aria-disabled="true"]');
      if (target) return 'blocked';
      return 'link';
    }

    /* Sidebar search input */
    if (el.closest('.sidebar-search-input')) return 'text';

    /* Settings inputs */
    if (el.closest('.settings-input, .settings-textarea, .settings-range')) return 'text';

    return 'default';
  }

  /* ── Apply a config to DOM elements ── */
  function applyState(state) {
    if (state === currentState) return;
    currentState = state;

    const c = STATE_CONFIGS[state] || STATE_CONFIGS.default;

    /* ── Dot ── */
    dot.style.opacity    = c.dot.show ? '1' : '0';
    dot.style.width      = c.dot.size + 'px';
    dot.style.height     = c.dot.size + 'px';
    dot.style.background = c.dot.color;

    /* ── Ring ── */
    ring.style.opacity      = c.ring.show ? '1' : '0';
    ring.style.width        = (c.ring.w || c.ring.size) + 'px';
    ring.style.height       = (c.ring.h || c.ring.size) + 'px';
    ring.style.borderColor  = c.ring.color;
    ring.style.borderRadius = c.ring.radius;
    ring.style.background   = c.ring.bg;
    ring.style.boxShadow    = c.ring.glow;

    /* Spinning ring (loading state) */
    if (c.ring.spin) {
      ring.style.borderTopColor = 'transparent';
      if (!spinRafId) startSpin();
    } else {
      stopSpin();
      ring.style.borderTopColor = c.ring.color;
      /* Don't reset transform — lerp handles position */
    }

    /* ── Sub-elements ── */
    ibeam.style.opacity     = c.ibeam    ? '1' : '0';
    zoomEl.style.opacity    = c.zoom     ? '1' : '0';
    thinkingEl.style.opacity = c.thinking ? '1' : '0';

    /* ── Label ── */
    if (c.label) {
      labelEl.textContent  = c.label;
      labelEl.style.opacity = '1';
    } else {
      labelEl.style.opacity = '0';
      labelEl.textContent  = '';
    }

    /* ── State class on root ── */
    cursorEl.className = `state-${state}`;
  }

  /* ── Spin animation for loading ring ── */
  function startSpin() {
    function step() {
      spinAngle += 8;
      ring.style.transform = `translate(-50%,-50%) rotate(${spinAngle}deg)`;
      spinRafId = requestAnimationFrame(step);
    }
    spinRafId = requestAnimationFrame(step);
  }

  function stopSpin() {
    if (spinRafId) {
      cancelAnimationFrame(spinRafId);
      spinRafId = null;
    }
    /* Reset ring transform — position kept by lerp */
    ring.style.transform = 'translate(-50%,-50%)';
    spinAngle = 0;
  }

  /* ── Main lerp RAF loop ── */
  function loop() {
    const c = STATE_CONFIGS[currentState] || STATE_CONFIGS.default;
    const lag = c.lag;

    rx += (mx - rx) * lag;
    ry += (my - ry) * lag;

    /* Ring follows lerped position */
    if (!spinRafId) {
      /* Not spinning — safe to set transform with lerp position */
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
    } else {
      /* Spinning — only update left/top, rotation handled by spinRaf */
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
    }

    /* Thinking orb also lerps */
    thinkingEl.style.left = rx + 'px';
    thinkingEl.style.top  = ry + 'px';

    rafId = requestAnimationFrame(loop);
  }

  /* ── Spawn click ripple ── */
  function spawnRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'cursor-click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top  = y + 'px';
    cursorEl.appendChild(ripple);

    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }

  /* ── Public: set state externally (e.g. from app.js) ── */
  function setState(state) {
    applyState(state);
  }

  /* ── Init ── */
  function init() {
    if (isTouch) return; /* Touch devices: skip everything */

    cursorEl    = document.getElementById('altas-cursor');
    dot         = document.getElementById('altas-cursor-dot');
    ring        = document.getElementById('altas-cursor-ring');
    ibeam       = document.getElementById('altas-cursor-ibeam');
    zoomEl      = document.getElementById('altas-cursor-zoom');
    thinkingEl  = document.getElementById('altas-cursor-thinking');
    labelEl     = document.getElementById('altas-cursor-label');

    if (!cursorEl) return;

    /* Hide until first movement */
    dot.style.opacity        = '0';
    ring.style.opacity       = '0';
    ibeam.style.opacity      = '0';
    zoomEl.style.opacity     = '0';
    thinkingEl.style.opacity = '0';

    /* ── mousemove: update dot + ibeam + zoom positions exactly ── */
    document.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;

      /* Dot snaps exactly */
      dot.style.left  = mx + 'px';
      dot.style.top   = my + 'px';

      /* I-beam and zoom follow dot exactly */
      ibeam.style.left  = mx + 'px';
      ibeam.style.top   = my + 'px';
      zoomEl.style.left = mx + 'px';
      zoomEl.style.top  = my + 'px';

      /* Show cursor on first move */
      if (!isVisible) {
        isVisible = true;
        cursorEl.classList.remove('hidden');
        const c = STATE_CONFIGS[currentState];
        dot.style.opacity  = c.dot.show  ? '1' : '0';
        ring.style.opacity = c.ring.show ? '1' : '0';
      }

      /* Infer state from element under cursor */
      const el = document.elementFromPoint(e.clientX, e.clientY);
      /* Don't infer if cursor is locked to a state externally */
      if (!cursorEl.dataset.locked) {
        const newState = inferState(el);
        applyState(newState);
      }
    });

    /* ── mouseleave: hide cursor when it leaves window ── */
    document.addEventListener('mouseleave', () => {
      isVisible = false;
      cursorEl.classList.add('hidden');
    });

    document.addEventListener('mouseenter', () => {
      isVisible = true;
      cursorEl.classList.remove('hidden');
    });

    /* ── mousedown: click flash + ripple ── */
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; /* Left click only */
      spawnRipple(e.clientX, e.clientY);

      /* Transient click state */
      const prev = currentState;
      if (prev !== 'blocked' && prev !== 'thinking') {
        applyState('click');
        setTimeout(() => applyState(prev), 150);
      }
    });

    /* ── Start lerp loop ── */
    loop();

    /* ── Apply initial state ── */
    applyState('default');
  }

  return { init, setState };

})();


/* ─────────────────────────────────────────────────────────────
   2. TOAST NOTIFICATION SYSTEM
   ───────────────────────────────────────────────────────────── */

const ALTASToast = (() => {

  const DURATION = 3000;
  let container = null;

  function getContainer() {
    if (!container) container = document.getElementById('toast-container');
    return container;
  }

  function show(message, type = 'default', duration = DURATION) {
    const c = getContainer();
    if (!c) return;

    const toast = document.createElement('div');
    toast.className = `toast${type !== 'default' ? ` toast-${type}` : ''}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');

    c.appendChild(toast);

    /* Auto-remove after duration + exit animation */
    setTimeout(() => {
      toast.style.animation = `toast-exit 0.3s cubic-bezier(0.7,0,0.84,0) forwards`;
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);

    return toast;
  }

  return {
    show,
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    info:    (msg) => show(msg, 'default'),
  };

})();


/* ─────────────────────────────────────────────────────────────
   3. BOOT SEQUENCE
   Animates the boot screen progress bar, then fades it out
   and reveals the app with staggered CSS animations
   ───────────────────────────────────────────────────────────── */

const ALTASBoot = (() => {

  const STEPS = [
    { pct: 12,  label: 'Loading modules',     delay: 0   },
    { pct: 28,  label: 'Connecting to ALTAS', delay: 280 },
    { pct: 52,  label: 'Initialising memory', delay: 480 },
    { pct: 74,  label: 'Applying settings',   delay: 640 },
    { pct: 90,  label: 'Preparing interface', delay: 780 },
    { pct: 100, label: 'Ready',               delay: 920 },
  ];

  function run(onComplete) {
    const screen  = document.getElementById('boot-screen');
    const bar     = document.getElementById('boot-bar-fill');
    const label   = document.getElementById('boot-label');

    if (!screen) { onComplete?.(); return; }

    /* Step through progress bar */
    STEPS.forEach(({ pct, label: text, delay }) => {
      setTimeout(() => {
        if (bar)   bar.style.width = pct + '%';
        if (label) label.textContent = text;
      }, delay);
    });

    /* Fade out boot screen, reveal app */
    setTimeout(() => {
      screen.classList.add('hidden');

      const app = document.getElementById('app');
      if (app) {
        app.classList.add('booted');

        /* Assign --chip-i to each chip for stagger delay */
        document.querySelectorAll('.chip').forEach((chip, i) => {
          chip.style.setProperty('--chip-i', i);
        });
      }

      /* Boot screen fully removed from layout after transition */
      screen.addEventListener('transitionend', () => {
        screen.remove();
      }, { once: true });

      onComplete?.();
    }, 1100);
  }

  return { run };

})();


/* ─────────────────────────────────────────────────────────────
   4. TEXTAREA AUTO-RESIZE
   Grows the prompt input up to a max height
   ───────────────────────────────────────────────────────────── */

const ALTASTextarea = (() => {

  const MAX_HEIGHT = 180; /* px — matches CSS max-height */

  function init(el) {
    if (!el) return;

    function resize() {
      el.style.height = 'auto';
      const h = Math.min(el.scrollHeight, MAX_HEIGHT);
      el.style.height = h + 'px';
      el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    }

    el.addEventListener('input', resize);

    /* Initial size */
    resize();

    return { resize };
  }

  return { init };

})();


/* ─────────────────────────────────────────────────────────────
   5. CHAR COUNT + SEND BUTTON STATE
   ───────────────────────────────────────────────────────────── */

const ALTASInput = (() => {

  const WARN_THRESHOLD = 28000; /* chars before warning */
  const MAX_CHARS      = 32000;

  function init({ input, sendBtn, charCount, hint }) {
    if (!input) return;

    function update() {
      const len  = input.value.length;
      const trim = input.value.trim();

      /* Char count */
      if (charCount) {
        if (len > 0) {
          charCount.textContent = `${len.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
          charCount.classList.toggle('warn', len >= WARN_THRESHOLD);
        } else {
          charCount.textContent = '';
          charCount.classList.remove('warn');
        }
      }

      /* Send button enable/disable */
      if (sendBtn) {
        const canSend = trim.length > 0;
        sendBtn.disabled = !canSend;
        sendBtn.setAttribute('aria-disabled', String(!canSend));
        sendBtn.classList.toggle('active', canSend);
      }

      /* Hint visibility */
      if (hint) {
        hint.classList.toggle('active', trim.length > 0);
      }
    }

    input.addEventListener('input', update);
    update();

    return { update };
  }

  return { init };

})();


/* ─────────────────────────────────────────────────────────────
   6. SIDEBAR TOGGLE (mobile)
   ───────────────────────────────────────────────────────────── */

const ALTASSidebar = (() => {

  let open = false;

  function init() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle');

    if (!sidebar) return;

    function show() {
      open = true;
      sidebar.classList.add('open');
      overlay.classList.add('visible');
      toggleBtn?.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    function hide() {
      open = false;
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      toggleBtn?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    function toggle() { open ? hide() : show(); }

    toggleBtn?.addEventListener('click', toggle);
    overlay?.addEventListener('click', hide);

    /* Close on Escape */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) hide();
    });

    return { show, hide, toggle };
  }

  return { init };

})();


/* ─────────────────────────────────────────────────────────────
   7. SETTINGS PANEL — STUB
   Full implementation is in settings.js (loaded after ui.js).
   This stub only provides getSettings() for early callers.
   settings.js overwrites ALTAS.Settings on window.ALTAS.
   ───────────────────────────────────────────────────────────── */

const ALTASSettingsStub = (() => {

  function getSettings() {
    try {
      const raw = localStorage.getItem('altas_settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function init() { /* delegated to settings.js */ }

  return { init, getSettings };

})();

/* Temporary placeholder — settings.js replaces this */
const _ALTASSettingsTemp = (() => {

  let panel = null;

  function init() {
    panel = document.getElementById('settings-panel-legacy');
    const openBtn  = document.getElementById('btn-settings');
    const closeBtn = document.getElementById('settings-close');
    const backdrop = document.getElementById('settings-backdrop');
    const tempRange  = document.getElementById('setting-temperature');
    const tempValue  = document.getElementById('temp-value');
    const tokRange   = document.getElementById('setting-max-tokens');
    const tokValue   = document.getElementById('tokens-value');
    const saveBtn    = document.getElementById('settings-save');
    const backendUrl = document.getElementById('setting-backend-url');
    const systemPrompt = document.getElementById('setting-system-prompt');

    /* Load saved settings */
    _loadSettings({ backendUrl, systemPrompt, tempRange, tempValue, tokRange, tokValue });

    /* Open */
    openBtn?.addEventListener('click', () => {
      panel.hidden = false;
      panel.removeAttribute('hidden');
      ALTASCursor.setState('default');
    });

    /* Close */
    function close() {
      panel.hidden = true;
    }

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) close();
    });

    /* Live slider labels */
    tempRange?.addEventListener('input', () => {
      if (tempValue) tempValue.textContent = parseFloat(tempRange.value).toFixed(2);
      tempRange.setAttribute('aria-valuenow', tempRange.value);
    });

    tokRange?.addEventListener('input', () => {
      if (tokValue) tokValue.textContent = parseInt(tokRange.value).toLocaleString();
    });

    /* Save */
    saveBtn?.addEventListener('click', () => {
      _saveSettings({ backendUrl, systemPrompt, tempRange, tokRange });
      close();
      ALTASToast.success('Settings saved');
    });
  }

  function _saveSettings({ backendUrl, systemPrompt, tempRange, tokRange }) {
    try {
      const settings = {
        backendUrl:   backendUrl?.value?.trim() || '',
        systemPrompt: systemPrompt?.value?.trim() || '',
        temperature:  parseFloat(tempRange?.value || 0.7),
        maxTokens:    parseInt(tokRange?.value || 1024),
      };
      localStorage.setItem('altas_settings', JSON.stringify(settings));
      return settings;
    } catch (e) {
      console.warn('ALTAS: Could not save settings', e);
    }
  }

  function _loadSettings({ backendUrl, systemPrompt, tempRange, tempValue, tokRange, tokValue }) {
    try {
      const raw = localStorage.getItem('altas_settings');
      if (!raw) return;
      const s = JSON.parse(raw);

      if (backendUrl  && s.backendUrl)   backendUrl.value   = s.backendUrl;
      if (systemPrompt && s.systemPrompt) systemPrompt.value = s.systemPrompt;
      if (tempRange && s.temperature != null) {
        tempRange.value = s.temperature;
        if (tempValue) tempValue.textContent = parseFloat(s.temperature).toFixed(2);
      }
      if (tokRange && s.maxTokens) {
        tokRange.value = s.maxTokens;
        if (tokValue) tokValue.textContent = parseInt(s.maxTokens).toLocaleString();
      }
    } catch (e) {
      console.warn('ALTAS: Could not load settings', e);
    }
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem('altas_settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  return { init, getSettings: () => ({}) };

})();


/* ─────────────────────────────────────────────────────────────
   8. KEYBOARD SHORTCUTS OVERLAY
   ───────────────────────────────────────────────────────────── */

const ALTASShortcuts = (() => {

  let overlay = null;
  let open    = false;

  function init() {
    overlay = document.getElementById('shortcuts-overlay');
    const closeBtn  = document.getElementById('shortcuts-close');
    const backdrop  = document.getElementById('shortcuts-backdrop');

    closeBtn?.addEventListener('click', hide);
    backdrop?.addEventListener('click', hide);
  }

  function show() {
    if (!overlay) return;
    open = true;
    overlay.hidden = false;
    overlay.removeAttribute('hidden');
  }

  function hide() {
    if (!overlay) return;
    open = false;
    overlay.hidden = true;
  }

  function toggle() { open ? hide() : show(); }

  return { init, show, hide, toggle };

})();


/* ─────────────────────────────────────────────────────────────
   9. SCROLL-TO-BOTTOM FAB
   ───────────────────────────────────────────────────────────── */

const ALTASScroll = (() => {

  let fab = null;

  function init(chatArea) {
    if (!chatArea) return;

    /* Create FAB */
    fab = document.createElement('button');
    fab.className = 'scroll-to-bottom';
    fab.setAttribute('aria-label', 'Scroll to latest message');
    fab.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7" y1="2" x2="7" y2="12"/>
        <path d="M3 8l4 4 4-4"/>
      </svg>
    `;

    chatArea.style.position = 'relative';
    chatArea.appendChild(fab);

    fab.addEventListener('click', () => scrollToBottom(chatArea, true));

    chatArea.addEventListener('scroll', () => {
      const distFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
      fab.classList.toggle('visible', distFromBottom > 120);
    });
  }

  function scrollToBottom(chatArea, smooth = true) {
    if (!chatArea) return;
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }

  function isAtBottom(chatArea, threshold = 80) {
    if (!chatArea) return true;
    const dist = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    return dist < threshold;
  }

  return { init, scrollToBottom, isAtBottom };

})();


/* ─────────────────────────────────────────────────────────────
   10. CONTEXT METER
   Shows approximate token usage in the header bar
   ───────────────────────────────────────────────────────────── */

const ALTASContextMeter = (() => {

  const MAX_TOKENS = 200000; /* Claude haiku context window */

  function update(usedTokens) {
    const fill  = document.getElementById('context-fill');
    const label = document.getElementById('context-label');
    if (!fill || !label) return;

    const pct = Math.min((usedTokens / MAX_TOKENS) * 100, 100);
    fill.style.width = pct + '%';

    /* Color shift as context fills */
    if (pct > 80) {
      fill.style.background = 'linear-gradient(90deg, #E8593C, #F2A623)';
    } else if (pct > 50) {
      fill.style.background = 'linear-gradient(90deg, #F2A623, #FFB43C)';
    } else {
      fill.style.background = 'linear-gradient(90deg, var(--accent-dim), var(--accent))';
    }

    label.textContent = usedTokens > 1000
      ? `${(usedTokens / 1000).toFixed(1)}k tokens`
      : `${usedTokens} tokens`;
  }

  return { update };

})();


/* ─────────────────────────────────────────────────────────────
   11. SESSION MESSAGE COUNTER (sidebar footer)
   ───────────────────────────────────────────────────────────── */

const ALTASSessionCounter = (() => {

  let count = 0;

  function increment() {
    count++;
    _render();
  }

  function reset() {
    count = 0;
    _render();
  }

  function _render() {
    const el = document.getElementById('session-count');
    if (el) el.textContent = `${count} message${count !== 1 ? 's' : ''}`;
  }

  return { increment, reset };

})();


/* ─────────────────────────────────────────────────────────────
   12. CONNECTION STATUS INDICATOR
   ───────────────────────────────────────────────────────────── */

const ALTASStatus = (() => {

  /* States: connecting | connected | error | thinking */
  function set(state) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (!dot || !text) return;

    dot.className = 'status-dot';

    switch (state) {
      case 'connected':
        dot.classList.add('connected');
        text.textContent = 'Connected';
        break;
      case 'thinking':
        dot.classList.add('thinking');
        text.textContent = 'Thinking…';
        break;
      case 'error':
        dot.classList.add('offline');
        text.textContent = 'Error';
        break;
      case 'connecting':
      default:
        text.textContent = 'Connecting…';
        break;
    }
  }

  return { set };

})();


/* ─────────────────────────────────────────────────────────────
   13. INPUT MODE INDICATOR (balanced / precise / creative)
   ───────────────────────────────────────────────────────────── */

const ALTASMode = (() => {

  let current = 'balanced';

  function init() {
    const btns = document.querySelectorAll('.header-mode-btn');
    const indicator = document.getElementById('input-mode');

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        current = btn.dataset.mode;

        /* Update button states */
        btns.forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });

        /* Update indicator label */
        if (indicator) indicator.textContent = current;

        /* Emit event for api.js to pick up */
        document.dispatchEvent(new CustomEvent('altas:mode-change', {
          detail: { mode: current }
        }));
      });
    });
  }

  function get() { return current; }

  return { init, get };

})();


/* ─────────────────────────────────────────────────────────────
   14. WELCOME CHIP CLICK HANDLER
   Fills the input and focuses it when a chip is clicked
   ───────────────────────────────────────────────────────────── */

function initWelcomeChips() {
  const chips = document.querySelectorAll('.chip[data-prompt]');
  const input = document.getElementById('prompt-input');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (!input) return;
      input.value = chip.dataset.prompt;
      input.focus();

      /* Trigger input event so send button activates */
      input.dispatchEvent(new Event('input', { bubbles: true }));

      /* Animate chip */
      chip.style.transform = 'scale(0.96)';
      setTimeout(() => { chip.style.transform = ''; }, 150);
    });
  });
}


/* ─────────────────────────────────────────────────────────────
   15. EXPORT CONVERSATION
   Converts chat history to markdown and downloads it
   ───────────────────────────────────────────────────────────── */

function exportConversation(messages) {
  if (!messages || messages.length === 0) {
    ALTASToast.error('Nothing to export yet');
    return;
  }

  const lines = [
    `# ALTAS Conversation Export`,
    `Date: ${new Date().toLocaleString()}`,
    `Model: claude-haiku-4-5`,
    `---`,
    '',
  ];

  messages.forEach(msg => {
    const role = msg.role === 'user' ? '**You**' : '**ALTAS**';
    lines.push(`${role}\n\n${msg.content}\n\n---\n`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `altas-chat-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  ALTASToast.success('Conversation exported');
}


/* ─────────────────────────────────────────────────────────────
   16. COPY TO CLIPBOARD HELPER
   ───────────────────────────────────────────────────────────── */

async function copyToClipboard(text, feedbackEl = null) {
  try {
    await navigator.clipboard.writeText(text);

    if (feedbackEl) {
      const prev = feedbackEl.textContent;
      feedbackEl.textContent = 'Copied';
      feedbackEl.classList.add('copied');
      setTimeout(() => {
        feedbackEl.textContent = prev;
        feedbackEl.classList.remove('copied');
      }, 1800);
    }

    return true;
  } catch (e) {
    ALTASToast.error('Copy failed — please copy manually');
    return false;
  }
}


/* ─────────────────────────────────────────────────────────────
   17. EXPOSE GLOBALS
   All systems available on window.ALTAS for app.js / chat.js
   ───────────────────────────────────────────────────────────── */

window.ALTAS = {
  Cursor:         ALTASCursor,
  Toast:          ALTASToast,
  Boot:           ALTASBoot,
  Textarea:       ALTASTextarea,
  Input:          ALTASInput,
  Sidebar:        ALTASSidebar,
  Settings:       ALTASSettingsStub, /* Overwritten by settings.js after load */
  Shortcuts:      ALTASShortcuts,
  Scroll:         ALTASScroll,
  ContextMeter:   ALTASContextMeter,
  SessionCounter: ALTASSessionCounter,
  Status:         ALTASStatus,
  Mode:           ALTASMode,
  exportConversation,
  copyToClipboard,
};
