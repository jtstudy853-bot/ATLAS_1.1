/* ═══════════════════════════════════════════════════════════════
   ALTAS — SETTINGS.JS
   Settings overlay · Section navigation · General config
   GitHub integration · Tool integrations · Appearance
   Danger zone · About · Persists to localStorage
   Depends on: ui.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASSettings = (() => {

  /* ─────────────────────────────────────────────────────────
     1. DEFAULT CONFIG
     ───────────────────────────────────────────────────────── */

  const DEFAULTS = {
    /* General */
    backendUrl:      '',
    systemPrompt:    '',
    temperature:     0.7,
    maxTokens:       1024,
    model:           'claude-haiku-4-5-20251001',
    streamResponses: true,

    /* Appearance */
    accentColor:     '#7B6CFF',
    fontSize:        15,
    reducedMotion:   false,
    compactMode:     false,

    /* GitHub */
    githubToken:     '',
    githubUsername:  '',
    githubDefaultRepo: '',

    /* Integrations */
    notionToken:     '',
    notionEnabled:   false,
    webSearchEnabled: true,
    codeRunEnabled:  true,
    calendarEnabled: true,
    memoryEnabled:   true,
    notificationsEnabled: false,

    /* Internal */
    onboarded:       false,
  };

  const ACCENT_COLORS = [
    { hex: '#7B6CFF', label: 'Violet (default)' },
    { hex: '#4A9EFF', label: 'Blue'              },
    { hex: '#4ECCA3', label: 'Teal'              },
    { hex: '#F2A623', label: 'Amber'             },
    { hex: '#E8593C', label: 'Coral'             },
    { hex: '#C88CFF', label: 'Lavender'          },
    { hex: '#FF5050', label: 'Red'               },
    { hex: '#FFB43C', label: 'Gold'              },
  ];

  const MODELS = [
    { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5'  },
    { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6',            label: 'Claude Opus 4.6'   },
  ];

  /* ─────────────────────────────────────────────────────────
     2. STATE
     ───────────────────────────────────────────────────────── */

  const state = {
    config:         { ...DEFAULTS },
    open:           false,
    activeSection:  'general',
    githubRepos:    [],
    githubLoading:  false,
    unsaved:        false,
  };

  /* ─────────────────────────────────────────────────────────
     3. DOM REFS
     ───────────────────────────────────────────────────────── */

  const DOM = {};

  function cacheDOM() {
    DOM.overlay       = document.getElementById('settings-overlay');
    DOM.backdrop      = DOM.overlay?.querySelector('.settings-overlay-backdrop');
    DOM.closeBtn      = document.getElementById('settings-close-btn');
    DOM.navItems      = document.querySelectorAll('.settings-nav-item');
    DOM.panes         = document.querySelectorAll('.settings-pane');

    /* General */
    DOM.backendUrl    = document.getElementById('settings-backend-url');
    DOM.systemPrompt  = document.getElementById('settings-system-prompt');
    DOM.temperature   = document.getElementById('settings-temperature');
    DOM.tempValue     = document.getElementById('settings-temp-value');
    DOM.maxTokens     = document.getElementById('settings-max-tokens');
    DOM.tokensValue   = document.getElementById('settings-tokens-value');
    DOM.modelSelect   = document.getElementById('settings-model');
    DOM.streamToggle  = document.getElementById('settings-stream');
    DOM.btnSaveGeneral = document.getElementById('settings-save-general');

    /* GitHub */
    DOM.githubToken   = document.getElementById('settings-github-token');
    DOM.githubUser    = document.getElementById('settings-github-user');
    DOM.githubStatus  = document.getElementById('settings-github-status');
    DOM.btnConnectGH  = document.getElementById('settings-github-connect');
    DOM.btnDisconnectGH = document.getElementById('settings-github-disconnect');
    DOM.githubRepoList = document.getElementById('settings-github-repos');
    DOM.githubScopes  = document.getElementById('settings-github-scopes');
    DOM.githubTokenToggle = document.getElementById('github-token-toggle');

    /* Integrations */
    DOM.notionToken   = document.getElementById('settings-notion-token');
    DOM.notionStatus  = document.getElementById('settings-notion-status');
    DOM.btnConnectNotion = document.getElementById('settings-notion-connect');
    DOM.webSearchToggle  = document.getElementById('settings-web-search');
    DOM.codeRunToggle    = document.getElementById('settings-code-run');
    DOM.calendarToggle   = document.getElementById('settings-calendar');
    DOM.memoryToggle     = document.getElementById('settings-memory');
    DOM.notifyToggle     = document.getElementById('settings-notifications');

    /* Appearance */
    DOM.accentGrid    = document.getElementById('settings-accent-grid');
    DOM.fontSizeValue = document.getElementById('settings-fontsize-value');
    DOM.btnFontDown   = document.getElementById('settings-font-down');
    DOM.btnFontUp     = document.getElementById('settings-font-up');
    DOM.reducedMotion = document.getElementById('settings-reduced-motion');
    DOM.compactMode   = document.getElementById('settings-compact-mode');

    /* Danger zone */
    DOM.btnClearMemory = document.getElementById('settings-clear-memory');
    DOM.btnClearConvs  = document.getElementById('settings-clear-conversations');
    DOM.btnClearAll    = document.getElementById('settings-clear-all');

    /* About */
    DOM.aboutMemCount  = document.getElementById('about-memory-count');
    DOM.aboutConvCount = document.getElementById('about-conv-count');
    DOM.aboutProjCount = document.getElementById('about-proj-count');
  }

  /* ─────────────────────────────────────────────────────────
     4. INIT
     ───────────────────────────────────────────────────────── */

  function init() {
    cacheDOM();
    loadConfig();
    buildAccentColorGrid();
    buildModelSelect();
    populateFields();
    wireEvents();
  }

  /* ─────────────────────────────────────────────────────────
     5. OPEN / CLOSE
     ───────────────────────────────────────────────────────── */

  function open(section = 'general') {
    if (!DOM.overlay) return;
    state.open = true;

    DOM.overlay.hidden = false;
    DOM.overlay.removeAttribute('hidden');
    requestAnimationFrame(() => DOM.overlay.classList.add('open'));

    switchSection(section);
    updateAboutStats();

    /* Lock cursor to default — no thinking orb in settings */
    ALTAS.Cursor.setState('default');

    document.dispatchEvent(new CustomEvent('altas:settings-opened'));
  }

  function close() {
    if (!DOM.overlay) return;
    state.open = false;

    DOM.overlay.classList.remove('open');
    DOM.overlay.addEventListener('transitionend', () => {
      if (!state.open) DOM.overlay.hidden = true;
    }, { once: true });

    /* Restore cursor */
    ALTAS.Cursor.setState('default');
    const cursorEl = document.getElementById('altas-cursor');
    if (cursorEl) cursorEl.dataset.locked = '';

    document.dispatchEvent(new CustomEvent('altas:settings-closed'));
  }

  function toggle(section) {
    state.open ? close() : open(section);
  }

  /* ─────────────────────────────────────────────────────────
     6. SECTION NAVIGATION
     ───────────────────────────────────────────────────────── */

  function switchSection(section) {
    state.activeSection = section;

    DOM.navItems?.forEach(item => {
      const isActive = item.dataset.section === section;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', String(isActive));
    });

    DOM.panes?.forEach(pane => {
      pane.classList.toggle('active', pane.dataset.pane === section);
    });

    /* Update content header */
    const headerTitle = document.getElementById('settings-content-title');
    const headerSub   = document.getElementById('settings-content-subtitle');
    const meta = SECTION_META[section] || {};
    if (headerTitle) headerTitle.textContent = meta.title    || section;
    if (headerSub)   headerSub.textContent   = meta.subtitle || '';
  }

  const SECTION_META = {
    general:      { title: 'General',      subtitle: 'Backend, model, and behaviour settings'     },
    github:       { title: 'GitHub',       subtitle: 'Connect your GitHub account and repos'       },
    integrations: { title: 'Integrations', subtitle: 'Enable and configure ALTAS tools'           },
    appearance:   { title: 'Appearance',   subtitle: 'Colours, fonts, and motion preferences'     },
    danger:       { title: 'Danger Zone',  subtitle: 'Irreversible actions — proceed with care'   },
    about:        { title: 'About ALTAS',  subtitle: 'Version info, stats, and acknowledgements'  },
  };

  /* ─────────────────────────────────────────────────────────
     7. EVENT WIRING
     ───────────────────────────────────────────────────────── */

  function wireEvents() {

    /* Open via settings button in sidebar */
    document.getElementById('btn-settings')?.addEventListener('click', () => open());

    /* Close */
    DOM.closeBtn?.addEventListener('click', close);
    DOM.backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) close();
    });

    /* Nav items */
    DOM.navItems?.forEach(item => {
      item.addEventListener('click', () => switchSection(item.dataset.section));
    });

    /* ── General ── */
    DOM.temperature?.addEventListener('input', () => {
      const v = parseFloat(DOM.temperature.value).toFixed(2);
      if (DOM.tempValue) DOM.tempValue.textContent = v;
    });

    DOM.maxTokens?.addEventListener('input', () => {
      const v = parseInt(DOM.maxTokens.value).toLocaleString();
      if (DOM.tokensValue) DOM.tokensValue.textContent = v;
    });

    DOM.btnSaveGeneral?.addEventListener('click', saveGeneralSettings);

    /* ── GitHub ── */
    DOM.githubTokenToggle?.addEventListener('click', () => {
      const input = DOM.githubToken;
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      /* Swap eye icon */
      DOM.githubTokenToggle.innerHTML = isHidden
        ? _eyeOffIcon()
        : _eyeIcon();
    });

    DOM.btnConnectGH?.addEventListener('click', connectGitHub);
    DOM.btnDisconnectGH?.addEventListener('click', disconnectGitHub);

    /* ── Notion ── */
    DOM.btnConnectNotion?.addEventListener('click', connectNotion);

    /* ── Integrations toggles — save immediately ── */
    [
      DOM.webSearchToggle, DOM.codeRunToggle, DOM.calendarToggle,
      DOM.memoryToggle,    DOM.notifyToggle,
    ].forEach(toggle => {
      toggle?.addEventListener('change', saveIntegrationSettings);
    });

    /* ── Appearance ── */
    DOM.btnFontDown?.addEventListener('click', () => adjustFontSize(-1));
    DOM.btnFontUp?.addEventListener('click',   () => adjustFontSize( 1));

    DOM.reducedMotion?.addEventListener('change', () => {
      state.config.reducedMotion = DOM.reducedMotion.checked;
      applyAppearance();
      saveConfig();
    });

    DOM.compactMode?.addEventListener('change', () => {
      state.config.compactMode = DOM.compactMode.checked;
      applyAppearance();
      saveConfig();
    });

    /* ── Danger zone ── */
    DOM.btnClearMemory?.addEventListener('click', () => {
      if (!confirm('Clear all ALTAS memories? This cannot be undone.')) return;
      localStorage.removeItem('altas_memory');
      ALTAS.Toast.success('Memory cleared');
      updateAboutStats();
    });

    DOM.btnClearConvs?.addEventListener('click', () => {
      if (!confirm('Delete all conversations? This cannot be undone.')) return;
      localStorage.removeItem('altas_conversations');
      document.dispatchEvent(new CustomEvent('altas:conversations-cleared'));
      ALTAS.Toast.success('Conversations cleared');
      updateAboutStats();
    });

    DOM.btnClearAll?.addEventListener('click', () => {
      if (!confirm('Reset ALTAS completely? All data, settings, and memories will be deleted.')) return;
      if (!confirm('Are you absolutely sure? This is irreversible.')) return;
      const keep = ['altas_settings']; /* Keep settings so user can reconfigure */
      Object.keys(localStorage)
        .filter(k => k.startsWith('altas_') && !keep.includes(k))
        .forEach(k => localStorage.removeItem(k));
      ALTAS.Toast.success('ALTAS reset — refresh to start fresh');
      setTimeout(() => location.reload(), 1500);
    });
  }

  /* ─────────────────────────────────────────────────────────
     8. GENERAL SETTINGS SAVE
     ───────────────────────────────────────────────────────── */

  function saveGeneralSettings() {
    const url = DOM.backendUrl?.value?.trim();

    if (url && !url.startsWith('http')) {
      ALTAS.Toast.error('Backend URL must start with http:// or https://');
      DOM.backendUrl?.classList.add('error');
      setTimeout(() => DOM.backendUrl?.classList.remove('error'), 2000);
      return;
    }

    state.config.backendUrl    = url || '';
    state.config.systemPrompt  = DOM.systemPrompt?.value?.trim() || '';
    state.config.temperature   = parseFloat(DOM.temperature?.value || 0.7);
    state.config.maxTokens     = parseInt(DOM.maxTokens?.value || 1024);
    state.config.model         = DOM.modelSelect?.value || DEFAULTS.model;
    state.config.streamResponses = DOM.streamToggle?.checked ?? true;

    saveConfig();

    /* Notify api.js */
    document.dispatchEvent(new CustomEvent('altas:settings-saved', {
      detail: { config: state.config },
    }));

    ALTAS.Toast.success('Settings saved');
    state.unsaved = false;
  }

  function saveIntegrationSettings() {
    state.config.webSearchEnabled     = DOM.webSearchToggle?.checked ?? true;
    state.config.codeRunEnabled       = DOM.codeRunToggle?.checked   ?? true;
    state.config.calendarEnabled      = DOM.calendarToggle?.checked  ?? true;
    state.config.memoryEnabled        = DOM.memoryToggle?.checked    ?? true;
    state.config.notificationsEnabled = DOM.notifyToggle?.checked    ?? false;
    saveConfig();

    document.dispatchEvent(new CustomEvent('altas:integrations-updated', {
      detail: { config: state.config },
    }));
  }

  /* ─────────────────────────────────────────────────────────
     9. GITHUB INTEGRATION
     ───────────────────────────────────────────────────────── */

  async function connectGitHub() {
    const token = DOM.githubToken?.value?.trim();
    if (!token) {
      ALTAS.Toast.error('Enter your GitHub personal access token');
      DOM.githubToken?.focus();
      return;
    }

    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      ALTAS.Toast.error('Token should start with ghp_ or github_pat_');
      return;
    }

    state.githubLoading = true;
    _setGHStatus('connecting');

    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error('Invalid token — check your PAT');
        throw new Error(`GitHub error: ${res.status}`);
      }

      const user = await res.json();

      /* Save */
      state.config.githubToken    = token;
      state.config.githubUsername = user.login;
      saveConfig();

      /* Update UI */
      if (DOM.githubUser) DOM.githubUser.textContent = `@${user.login}`;
      _setGHStatus('connected');
      ALTAS.Toast.success(`Connected as @${user.login}`);

      /* Fetch repos */
      await fetchGitHubRepos(token);

    } catch (err) {
      _setGHStatus('error');
      ALTAS.Toast.error(err.message || 'GitHub connection failed');
    } finally {
      state.githubLoading = false;
    }
  }

  async function fetchGitHubRepos(token) {
    const t = token || state.config.githubToken;
    if (!t) return;

    try {
      const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return;

      const repos = await res.json();
      state.githubRepos = repos;
      renderGitHubRepos(repos);
    } catch {
      /* Silently fail — token validated already */
    }
  }

  function renderGitHubRepos(repos) {
    if (!DOM.githubRepoList) return;
    DOM.githubRepoList.innerHTML = '';

    if (!repos || repos.length === 0) {
      DOM.githubRepoList.innerHTML = `
        <div class="github-repo-empty">No repositories found</div>
      `;
      return;
    }

    repos.forEach(repo => {
      const item = document.createElement('div');
      item.className = `github-repo-item${repo.full_name === state.config.githubDefaultRepo ? ' selected' : ''}`;
      item.dataset.repo = repo.full_name;

      item.innerHTML = `
        <div class="github-repo-dot"></div>
        <span class="github-repo-name">${_escapeHtml(repo.full_name)}</span>
        <span class="github-repo-visibility">${repo.private ? 'private' : 'public'}</span>
      `;

      item.addEventListener('click', () => {
        state.config.githubDefaultRepo = repo.full_name;
        saveConfig();
        /* Update selection */
        DOM.githubRepoList.querySelectorAll('.github-repo-item').forEach(i => {
          i.classList.toggle('selected', i.dataset.repo === repo.full_name);
        });
        ALTAS.Toast.success(`Default repo: ${repo.full_name}`);
      });

      DOM.githubRepoList.appendChild(item);
    });
  }

  function disconnectGitHub() {
    if (!confirm('Disconnect GitHub? Your token will be removed.')) return;
    state.config.githubToken      = '';
    state.config.githubUsername   = '';
    state.config.githubDefaultRepo = '';
    state.githubRepos = [];
    saveConfig();

    if (DOM.githubToken)   DOM.githubToken.value = '';
    if (DOM.githubUser)    DOM.githubUser.textContent = '';
    if (DOM.githubRepoList) DOM.githubRepoList.innerHTML = '';
    _setGHStatus('disconnected');
    ALTAS.Toast.info('GitHub disconnected');
  }

  function _setGHStatus(status) {
    if (!DOM.githubStatus) return;
    DOM.githubStatus.className = `integration-status ${status === 'connecting' ? '' : status}`;

    const labels = {
      connected:    'Connected',
      disconnected: 'Not connected',
      error:        'Connection failed',
      connecting:   'Connecting…',
    };

    DOM.githubStatus.innerHTML = `
      <div class="integration-status-dot"></div>
      ${labels[status] || status}
    `;
  }

  /* ─────────────────────────────────────────────────────────
     10. NOTION INTEGRATION
     ───────────────────────────────────────────────────────── */

  async function connectNotion() {
    const token = DOM.notionToken?.value?.trim();
    if (!token) {
      ALTAS.Toast.error('Enter your Notion integration token');
      DOM.notionToken?.focus();
      return;
    }

    /* Notion tokens start with secret_ */
    if (!token.startsWith('secret_')) {
      ALTAS.Toast.error('Notion token should start with secret_');
      return;
    }

    try {
      state.config.notionToken   = token;
      state.config.notionEnabled = true;
      saveConfig();

      if (DOM.notionStatus) {
        DOM.notionStatus.className = 'integration-status connected';
        DOM.notionStatus.innerHTML = `<div class="integration-status-dot"></div>Connected`;
      }

      ALTAS.Toast.success('Notion token saved — ALTAS will use it for searches');

    } catch (err) {
      ALTAS.Toast.error('Could not connect to Notion');
    }
  }

  /* ─────────────────────────────────────────────────────────
     11. APPEARANCE
     ───────────────────────────────────────────────────────── */

  function buildAccentColorGrid() {
    if (!DOM.accentGrid) return;
    DOM.accentGrid.innerHTML = '';

    ACCENT_COLORS.forEach(({ hex, label }) => {
      const swatch = document.createElement('div');
      swatch.className = `accent-color-swatch${hex === state.config.accentColor ? ' selected' : ''}`;
      swatch.style.background = hex;
      swatch.style.color      = hex;
      swatch.setAttribute('aria-label', label);
      swatch.setAttribute('title', label);
      swatch.dataset.color = hex;

      swatch.addEventListener('click', () => {
        state.config.accentColor = hex;
        saveConfig();
        applyAppearance();
        /* Sync selection */
        DOM.accentGrid.querySelectorAll('.accent-color-swatch').forEach(s => {
          s.classList.toggle('selected', s.dataset.color === hex);
        });
        ALTAS.Toast.info(`Accent: ${label}`);
      });

      DOM.accentGrid.appendChild(swatch);
    });
  }

  function adjustFontSize(delta) {
    const min = 13, max = 18;
    state.config.fontSize = Math.max(min, Math.min(max, (state.config.fontSize || 15) + delta));
    if (DOM.fontSizeValue) DOM.fontSizeValue.textContent = `${state.config.fontSize}px`;
    applyAppearance();
    saveConfig();
  }

  function applyAppearance() {
    const root = document.documentElement;

    /* Accent colour */
    if (state.config.accentColor) {
      const hex  = state.config.accentColor;
      const r    = parseInt(hex.slice(1,3),16);
      const g    = parseInt(hex.slice(3,5),16);
      const b    = parseInt(hex.slice(5,7),16);
      root.style.setProperty('--accent',              hex);
      root.style.setProperty('--accent-glow',         `rgba(${r},${g},${b},0.18)`);
      root.style.setProperty('--accent-glow-strong',  `rgba(${r},${g},${b},0.35)`);
      root.style.setProperty('--accent-bright',       _lightenHex(hex, 20));
      root.style.setProperty('--accent-dim',          _darkenHex(hex, 20));
    }

    /* Font size */
    if (state.config.fontSize) {
      root.style.setProperty('--font-size-base', `${state.config.fontSize}px`);
      document.body.style.fontSize = `${state.config.fontSize}px`;
    }

    /* Reduced motion */
    if (state.config.reducedMotion) {
      document.body.classList.add('reduced-motion');
    } else {
      document.body.classList.remove('reduced-motion');
    }

    /* Compact mode */
    if (state.config.compactMode) {
      document.body.classList.add('compact-mode');
    } else {
      document.body.classList.remove('compact-mode');
    }
  }

  /* ─────────────────────────────────────────────────────────
     12. ABOUT STATS
     ───────────────────────────────────────────────────────── */

  function updateAboutStats() {
    try {
      const memory = JSON.parse(localStorage.getItem('altas_memory') || '[]');
      const convs  = JSON.parse(localStorage.getItem('altas_conversations') || '[]');
      const projs  = JSON.parse(localStorage.getItem('altas_projects') || '[]');

      if (DOM.aboutMemCount)  DOM.aboutMemCount.textContent  = memory.length;
      if (DOM.aboutConvCount) DOM.aboutConvCount.textContent = convs.length;
      if (DOM.aboutProjCount) DOM.aboutProjCount.textContent = projs.length;
    } catch {
      /* ignore */
    }
  }

  /* ─────────────────────────────────────────────────────────
     13. POPULATE FIELDS FROM CONFIG
     ───────────────────────────────────────────────────────── */

  function populateFields() {
    const c = state.config;

    /* General */
    if (DOM.backendUrl)   DOM.backendUrl.value   = c.backendUrl   || '';
    if (DOM.systemPrompt) DOM.systemPrompt.value = c.systemPrompt || '';
    if (DOM.temperature) {
      DOM.temperature.value = c.temperature;
      if (DOM.tempValue) DOM.tempValue.textContent = parseFloat(c.temperature).toFixed(2);
    }
    if (DOM.maxTokens) {
      DOM.maxTokens.value = c.maxTokens;
      if (DOM.tokensValue) DOM.tokensValue.textContent = parseInt(c.maxTokens).toLocaleString();
    }
    if (DOM.modelSelect)  DOM.modelSelect.value  = c.model        || DEFAULTS.model;
    if (DOM.streamToggle) DOM.streamToggle.checked = c.streamResponses ?? true;

    /* GitHub */
    if (DOM.githubToken && c.githubToken) {
      DOM.githubToken.value = c.githubToken;
      /* Show connected state without re-fetching */
      _setGHStatus('connected');
      if (DOM.githubUser && c.githubUsername) {
        DOM.githubUser.textContent = `@${c.githubUsername}`;
      }
      /* Re-fetch repos silently */
      fetchGitHubRepos();
    } else {
      _setGHStatus('disconnected');
    }

    /* Notion */
    if (DOM.notionToken && c.notionToken) {
      DOM.notionToken.value = c.notionToken;
      if (DOM.notionStatus) {
        DOM.notionStatus.className = 'integration-status connected';
        DOM.notionStatus.innerHTML = `<div class="integration-status-dot"></div>Connected`;
      }
    }

    /* Integration toggles */
    if (DOM.webSearchToggle) DOM.webSearchToggle.checked = c.webSearchEnabled  ?? true;
    if (DOM.codeRunToggle)   DOM.codeRunToggle.checked   = c.codeRunEnabled    ?? true;
    if (DOM.calendarToggle)  DOM.calendarToggle.checked  = c.calendarEnabled   ?? true;
    if (DOM.memoryToggle)    DOM.memoryToggle.checked    = c.memoryEnabled     ?? true;
    if (DOM.notifyToggle)    DOM.notifyToggle.checked    = c.notificationsEnabled ?? false;

    /* Appearance */
    if (DOM.fontSizeValue) DOM.fontSizeValue.textContent = `${c.fontSize || 15}px`;
    if (DOM.reducedMotion) DOM.reducedMotion.checked = c.reducedMotion ?? false;
    if (DOM.compactMode)   DOM.compactMode.checked   = c.compactMode   ?? false;

    /* Apply appearance immediately */
    applyAppearance();
  }

  /* ─────────────────────────────────────────────────────────
     14. BUILD MODEL SELECT
     ───────────────────────────────────────────────────────── */

  function buildModelSelect() {
    if (!DOM.modelSelect) return;
    DOM.modelSelect.innerHTML = '';
    MODELS.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value       = value;
      opt.textContent = label;
      DOM.modelSelect.appendChild(opt);
    });
    DOM.modelSelect.value = state.config.model || DEFAULTS.model;
  }

  /* ─────────────────────────────────────────────────────────
     15. PERSIST CONFIG
     ───────────────────────────────────────────────────────── */

  function loadConfig() {
    try {
      const raw = localStorage.getItem('altas_settings');
      const saved = raw ? JSON.parse(raw) : {};
      state.config = { ...DEFAULTS, ...saved };
    } catch {
      state.config = { ...DEFAULTS };
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem('altas_settings', JSON.stringify(state.config));
    } catch (e) {
      console.warn('ALTAS Settings: Could not save', e);
    }
  }

  /* ─────────────────────────────────────────────────────────
     16. UTILS
     ───────────────────────────────────────────────────────── */

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _eyeIcon() {
    return `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 6.5S3 3 6.5 3 12 6.5 12 6.5 10 10 6.5 10 1 6.5 1 6.5z"/>
      <circle cx="6.5" cy="6.5" r="1.5"/>
    </svg>`;
  }

  function _eyeOffIcon() {
    return `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"
      stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 1l11 11M5.4 5.5A1.5 1.5 0 008 8M2.2 3.7C1.4 4.5 1 6.5 1 6.5S3 10 6.5 10c1 0 1.9-.3 2.7-.7M4.5 2.2C5.1 3 5.7 3 6.5 3c3.5 0 5.5 3.5 5.5 3.5s-.4 1.4-1.4 2.5"/>
    </svg>`;
  }

  function _lightenHex(hex, amount) {
    const r = Math.min(255, parseInt(hex.slice(1,3),16) + amount);
    const g = Math.min(255, parseInt(hex.slice(3,5),16) + amount);
    const b = Math.min(255, parseInt(hex.slice(5,7),16) + amount);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  function _darkenHex(hex, amount) {
    const r = Math.max(0, parseInt(hex.slice(1,3),16) - amount);
    const g = Math.max(0, parseInt(hex.slice(3,5),16) - amount);
    const b = Math.max(0, parseInt(hex.slice(5,7),16) - amount);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  /* ─────────────────────────────────────────────────────────
     17. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    init,
    open,
    close,
    toggle,
    saveConfig,
    loadConfig,
    applyAppearance,
    getConfig:  () => ({ ...state.config }),
    get isOpen() { return state.open; },
  };

})();

/* Auto-init */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASSettings.init);
} else {
  ALTASSettings.init();
}
