/* ═══════════════════════════════════════════════════════════════
   ALTAS — APP.JS
   Boot orchestrator · State machine · Keyboard shortcuts
   Conversation manager · Header controls · Global event wiring
   Depends on: ui.js · api.js · chat.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   EMERGENCY BOOT BYPASS
   If any JS error prevents normal boot, this removes the
   boot screen after 4 seconds no matter what.
   ───────────────────────────────────────────────────────────── */
setTimeout(() => {
  const screen = document.getElementById('boot-screen');
  const app    = document.getElementById('app');
  if (screen) screen.remove();
  if (app && !app.classList.contains('booted')) {
    app.classList.add('booted');
  }
}, 4000);

/* Global JS error logger — shows errors in a visible toast */
window.addEventListener('error', (e) => {
  console.error('ALTAS global error:', e.message, e.filename, e.lineno);
  /* Remove boot screen so user isn't stuck */
  const screen = document.getElementById('boot-screen');
  const app    = document.getElementById('app');
  if (screen) screen.remove();
  if (app) app.classList.add('booted');
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('ALTAS unhandled promise rejection:', e.reason);
});

/* ─────────────────────────────────────────────────────────────
   1. APP STATE
   Single source of truth for the entire application
   ───────────────────────────────────────────────────────────── */

const ALTASApp = (() => {

  /* Internal state */
  const state = {
    booted:          false,
    streaming:       false,       /* AI currently generating  */
    conversationId:  null,        /* Active conversation UUID */
    conversations:   [],          /* All saved conversations  */
    mode:            'balanced',  /* precise | balanced | creative */
    totalTokens:     0,           /* Approximate context token count */
    lastMessageEl:   null,        /* Last ALTAS message element       */
  };

  /* ─────────────────────────────────────────────────────────
     2. DOM REFS
     All cached on boot — never queried again mid-session
     ───────────────────────────────────────────────────────── */

  const DOM = {};

  function cacheDOM() {
    DOM.app            = document.getElementById('app');
    DOM.chatArea       = document.getElementById('chat-area');
    DOM.chatInner      = document.getElementById('chat-inner');
    DOM.welcome        = document.getElementById('welcome');
    DOM.promptInput    = document.getElementById('prompt-input');
    DOM.sendBtn        = document.getElementById('btn-send');
    DOM.charCount      = document.getElementById('char-count');
    DOM.inputHint      = document.getElementById('input-hint');
    DOM.inputShell     = document.getElementById('input-shell');
    DOM.headerTitle    = document.getElementById('header-chat-title');
    DOM.btnClear       = document.getElementById('btn-clear');
    DOM.btnExport      = document.getElementById('btn-export');
    DOM.btnNewChat     = document.getElementById('btn-new-chat');
    DOM.convListToday  = document.getElementById('conversation-list-today');
    DOM.convEmptyToday = document.getElementById('conv-empty-today');
    DOM.convGroupEarlier = document.getElementById('conv-group-earlier');
    DOM.convListEarlier  = document.getElementById('conversation-list-earlier');
    DOM.contextFill    = document.getElementById('context-fill');
    DOM.contextLabel   = document.getElementById('context-label');
    DOM.inputMode      = document.getElementById('input-mode');
  }

  /* ─────────────────────────────────────────────────────────
     3. BOOT SEQUENCE
     Orchestrates the full startup: DOM cache → ui init →
     boot animation → connection check → ready
     ───────────────────────────────────────────────────────── */

  async function boot() {
    /* Cache all DOM refs */
    cacheDOM();

    /* Initialise UI subsystems (cursor, sidebar, settings, shortcuts) */
    ALTAS.Cursor.init();
    ALTAS.Sidebar.init();
    /* Settings already auto-initialised by settings.js on load */
    /* ALTAS.Settings is the full ALTASSettings from settings.js */
    ALTAS.Shortcuts.init();
    ALTAS.Mode.init();
    ALTAS.Scroll.init(DOM.chatArea);

    /* Auto-resize textarea */
    ALTAS.Textarea.init(DOM.promptInput);

    /* Input state (send button, char count) */
    ALTAS.Input.init({
      input:    DOM.promptInput,
      sendBtn:  DOM.sendBtn,
      charCount: DOM.charCount,
      hint:     DOM.inputHint,
    });

    /* Wire all event listeners */
    wireEvents();

    /* Load saved conversations from localStorage */
    loadConversations();

    /* Start a fresh conversation */
    newConversation();

    /* Status: connecting */
    ALTAS.Status.set('connecting');

    /* Run boot animation, then check connection */
    ALTAS.Boot.run(async () => {
      state.booted = true;

      /* Ping backend to confirm it's up */
      const ok = await ALTASAPI.ping();
      ALTAS.Status.set(ok ? 'connected' : 'error');

      if (!ok) {
        ALTAS.Toast.error('Cannot reach backend — check Settings');
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     4. EVENT WIRING
     All user interactions wired here — no inline handlers
     ───────────────────────────────────────────────────────── */

  function wireEvents() {

    /* ── Send on Enter (not Shift+Enter) ── */
    DOM.promptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!state.streaming) submitMessage();
      }
    });

    /* ── Send button click ── */
    DOM.sendBtn?.addEventListener('click', () => {
      if (state.streaming) {
        /* Stop button: abort the stream */
        ALTASAPI.abort();
        setStreamingState(false);
        ALTAS.Toast.info('Response stopped');
      } else {
        submitMessage();
      }
    });

    /* ── New chat ── */
    DOM.btnNewChat?.addEventListener('click', () => {
      if (state.streaming) ALTASAPI.abort();
      newConversation();
    });

    /* ── Clear conversation ── */
    DOM.btnClear?.addEventListener('click', () => {
      if (state.streaming) ALTASAPI.abort();
      clearConversation();
    });

    /* ── Export ── */
    DOM.btnExport?.addEventListener('click', () => {
      const messages = ALTASChat.getMessages();
      ALTAS.exportConversation(messages);
    });

    /* ── Keyboard shortcuts ── */
    document.addEventListener('keydown', handleGlobalShortcuts);

    /* ── Mode change from header toggle ── */
    document.addEventListener('altas:mode-change', (e) => {
      state.mode = e.detail.mode;
      if (DOM.inputMode) DOM.inputMode.textContent = state.mode;
    });

    /* ── Settings save → update backend URL in API ── */
    document.addEventListener('altas:settings-saved', () => {
      const s = ALTAS.Settings.getConfig ? ALTAS.Settings.getConfig() : ALTAS.Settings.getSettings();
      ALTASAPI.setBackendUrl(s.backendUrl);
    });

    /* ── Conversation search ── */
    const searchInput = document.getElementById('conv-search');
    searchInput?.addEventListener('input', (e) => {
      filterConversations(e.target.value.trim());
    });
  }

  /* ─────────────────────────────────────────────────────────
     5. GLOBAL KEYBOARD SHORTCUTS
     ───────────────────────────────────────────────────────── */

  function handleGlobalShortcuts(e) {
    const mod = e.metaKey || e.ctrlKey;

    /* ⌘K — New conversation */
    if (mod && e.key === 'k') {
      e.preventDefault();
      if (state.streaming) ALTASAPI.abort();
      newConversation();
      DOM.promptInput?.focus();
      return;
    }

    /* ⌘/ — Shortcuts overlay */
    if (mod && e.key === '/') {
      e.preventDefault();
      ALTAS.Shortcuts.toggle();
      return;
    }

    /* ⌘L — Focus input */
    if (mod && e.key === 'l') {
      e.preventDefault();
      DOM.promptInput?.focus();
      DOM.promptInput?.select();
      return;
    }

    /* ⌘⇧C — Copy last ALTAS response */
    if (mod && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      const messages = ALTASChat.getMessages();
      const lastAltas = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAltas) {
        ALTAS.copyToClipboard(lastAltas.content);
        ALTAS.Toast.success('Last response copied');
      } else {
        ALTAS.Toast.info('No response to copy yet');
      }
      return;
    }

    /* ⌘⇧X — Clear conversation */
    if (mod && e.shiftKey && e.key === 'X') {
      e.preventDefault();
      clearConversation();
      return;
    }

    /* Escape — close any open overlays, blur input */
    if (e.key === 'Escape') {
      DOM.promptInput?.blur();
      return;
    }
  }

  /* ─────────────────────────────────────────────────────────
     6. MESSAGE SUBMISSION
     Validates input → renders user message → calls API →
     streams ALTAS response → saves conversation
     ───────────────────────────────────────────────────────── */

  async function submitMessage() {
    const raw = DOM.promptInput?.value?.trim();
    if (!raw || state.streaming) return;

    /* Hide welcome screen on first message */
    hideWelcome();

    /* Clear input */
    const prompt = raw;
    DOM.promptInput.value = '';
    DOM.promptInput.style.height = 'auto';
    DOM.promptInput.dispatchEvent(new Event('input', { bubbles: true }));

    /* Render user message */
    ALTASChat.appendUserMessage(prompt);
    ALTAS.SessionCounter.increment();

    /* Approximate token count (4 chars ≈ 1 token) */
    state.totalTokens += Math.ceil(prompt.length / 4);
    ALTAS.ContextMeter.update(state.totalTokens);

    /* Scroll to bottom */
    ALTAS.Scroll.scrollToBottom(DOM.chatArea, true);

    /* Enter streaming state */
    setStreamingState(true);

    /* Build messages array for API */
    const messages = ALTASChat.getMessages();

    /* Get settings */
    const settings = ALTAS.Settings.getConfig ? ALTAS.Settings.getConfig() : ALTAS.Settings.getSettings();

    /* Show typing indicator */
    const typingEl = ALTASChat.showTypingIndicator();

    try {
      /* Stream response */
      const responseText = await ALTASAPI.streamMessage({
        messages,
        mode:         state.mode,
        temperature:  settings.temperature,
        maxTokens:    settings.maxTokens,
        onChunk:      (chunk, fullText) => {
          /* Remove typing indicator on first chunk */
          if (typingEl?.parentNode) typingEl.remove();
          ALTASChat.streamChunk(chunk, fullText);

          /* Auto-scroll if user was at bottom */
          if (ALTAS.Scroll.isAtBottom(DOM.chatArea)) {
            ALTAS.Scroll.scrollToBottom(DOM.chatArea, false);
          }
        },
        onComplete:   (fullText, usage) => {
          ALTASChat.finaliseStream(fullText);

          /* Update token count from actual usage */
          if (usage?.total_tokens) {
            state.totalTokens = usage.total_tokens;
            ALTAS.ContextMeter.update(state.totalTokens);
          } else {
            state.totalTokens += Math.ceil(fullText.length / 4);
            ALTAS.ContextMeter.update(state.totalTokens);
          }

          ALTAS.SessionCounter.increment();
          saveConversation();
        },
      });

    } catch (err) {
      /* Remove typing indicator */
      if (typingEl?.parentNode) typingEl.remove();

      if (err.name === 'AbortError') {
        /* User stopped — already handled */
      } else {
        ALTASChat.appendErrorMessage(err.message || 'Something went wrong. Please try again.');
        ALTAS.Status.set('error');
        ALTAS.Toast.error('Response failed — check your connection');
        console.error('ALTAS API Error:', err);
      }
    } finally {
      setStreamingState(false);
      ALTAS.Scroll.scrollToBottom(DOM.chatArea, true);
    }
  }

  /* ─────────────────────────────────────────────────────────
     7. STREAMING STATE MANAGEMENT
     Toggles UI between idle and streaming modes
     ───────────────────────────────────────────────────────── */

  function setStreamingState(streaming) {
    state.streaming = streaming;

    /* Cursor: thinking orb while streaming */
    ALTAS.Cursor.setState(streaming ? 'thinking' : 'default');

    /* Lock cursor to thinking state during stream */
    const cursorEl = document.getElementById('altas-cursor');
    if (cursorEl) {
      cursorEl.dataset.locked = streaming ? 'true' : '';
    }

    /* Status dot */
    ALTAS.Status.set(streaming ? 'thinking' : 'connected');

    /* Send button: swap to stop icon */
    if (DOM.sendBtn) {
      const sendIcon = DOM.sendBtn.querySelector('.btn-send-icon--send');
      const stopIcon = DOM.sendBtn.querySelector('.btn-send-icon--stop');

      if (streaming) {
        DOM.sendBtn.disabled = false;
        DOM.sendBtn.setAttribute('aria-label', 'Stop response');
        DOM.sendBtn.classList.add('active', 'streaming');
        if (sendIcon) sendIcon.style.display = 'none';
        if (stopIcon) stopIcon.style.display = 'flex';
      } else {
        DOM.sendBtn.setAttribute('aria-label', 'Send message');
        DOM.sendBtn.classList.remove('streaming');
        if (sendIcon) sendIcon.style.display = 'flex';
        if (stopIcon) stopIcon.style.display = 'none';
        /* Re-check input to set correct enabled state */
        const hasText = DOM.promptInput?.value?.trim().length > 0;
        DOM.sendBtn.disabled = !hasText;
        DOM.sendBtn.classList.toggle('active', hasText);
      }
    }

    /* Input: disable while streaming */
    if (DOM.promptInput) {
      DOM.promptInput.disabled = streaming;
      DOM.promptInput.style.opacity = streaming ? '0.5' : '1';
    }
  }

  /* ─────────────────────────────────────────────────────────
     8. CONVERSATION MANAGEMENT
     Create · Clear · Save · Load · Render sidebar list
     ───────────────────────────────────────────────────────── */

  function newConversation() {
    /* Save current if it has messages */
    const existing = ALTASChat.getMessages();
    if (existing.length > 0) saveConversation();

    /* Generate new ID */
    state.conversationId = `conv_${Date.now()}`;
    state.totalTokens    = 0;

    /* Reset chat */
    ALTASChat.reset();
    ALTAS.ContextMeter.update(0);
    ALTAS.SessionCounter.reset();

    /* Show welcome screen */
    showWelcome();

    /* Update header */
    setHeaderTitle('New conversation');

    /* Focus input */
    setTimeout(() => DOM.promptInput?.focus(), 300);

    /* Re-render sidebar */
    renderConversationList();
  }

  function clearConversation() {
    ALTASChat.clear();
    state.totalTokens = 0;
    ALTAS.ContextMeter.update(0);
    ALTAS.SessionCounter.reset();
    showWelcome();
    setHeaderTitle('New conversation');
    ALTAS.Toast.info('Conversation cleared');
  }

  function saveConversation() {
    const messages = ALTASChat.getMessages();
    if (messages.length === 0) return;

    /* Build title from first user message */
    const firstUser = messages.find(m => m.role === 'user');
    const title = firstUser
      ? firstUser.content.slice(0, 52) + (firstUser.content.length > 52 ? '…' : '')
      : 'Untitled conversation';

    /* Update or insert */
    const idx = state.conversations.findIndex(c => c.id === state.conversationId);
    const conv = {
      id:        state.conversationId,
      title,
      messages,
      timestamp: Date.now(),
      tokens:    state.totalTokens,
    };

    if (idx !== -1) {
      state.conversations[idx] = conv;
    } else {
      state.conversations.unshift(conv);
    }

    /* Persist */
    try {
      /* Only keep last 40 conversations to manage storage */
      const toSave = state.conversations.slice(0, 40);
      localStorage.setItem('altas_conversations', JSON.stringify(toSave));
    } catch (e) {
      /* Storage full — clear old ones */
      console.warn('ALTAS: localStorage full, pruning old conversations');
      state.conversations = state.conversations.slice(0, 20);
      try {
        localStorage.setItem('altas_conversations', JSON.stringify(state.conversations));
      } catch (_) { /* Give up */ }
    }

    /* Update header title */
    setHeaderTitle(title);

    /* Re-render sidebar */
    renderConversationList();
  }

  function loadConversations() {
    try {
      const raw = localStorage.getItem('altas_conversations');
      state.conversations = raw ? JSON.parse(raw) : [];
    } catch {
      state.conversations = [];
    }
    renderConversationList();
  }

  function loadConversation(id) {
    const conv = state.conversations.find(c => c.id === id);
    if (!conv) return;

    /* Save current first */
    const current = ALTASChat.getMessages();
    if (current.length > 0) saveConversation();

    /* Switch */
    state.conversationId = conv.id;
    state.totalTokens    = conv.tokens || 0;

    /* Restore chat */
    hideWelcome();
    ALTASChat.restoreMessages(conv.messages);
    ALTAS.ContextMeter.update(state.totalTokens);
    ALTAS.SessionCounter.reset();

    setHeaderTitle(conv.title);
    renderConversationList();

    /* Scroll to bottom */
    setTimeout(() => ALTAS.Scroll.scrollToBottom(DOM.chatArea, false), 100);
  }

  function deleteConversation(id) {
    state.conversations = state.conversations.filter(c => c.id !== id);
    try {
      localStorage.setItem('altas_conversations', JSON.stringify(state.conversations));
    } catch { /* ignore */ }

    /* If deleting active conversation, start fresh */
    if (id === state.conversationId) {
      newConversation();
    } else {
      renderConversationList();
    }
  }

  /* ─────────────────────────────────────────────────────────
     9. CONVERSATION SIDEBAR RENDER
     ───────────────────────────────────────────────────────── */

  function renderConversationList(filter = '') {
    if (!DOM.convListToday) return;

    const now   = Date.now();
    const DAY   = 86400000;

    const filtered = filter
      ? state.conversations.filter(c =>
          c.title.toLowerCase().includes(filter.toLowerCase())
        )
      : state.conversations;

    const today   = filtered.filter(c => now - c.timestamp < DAY);
    const earlier = filtered.filter(c => now - c.timestamp >= DAY);

    /* ── Today ── */
    DOM.convListToday.innerHTML = '';

    if (today.length === 0) {
      if (DOM.convEmptyToday) {
        DOM.convEmptyToday.style.display = 'block';
      }
    } else {
      if (DOM.convEmptyToday) {
        DOM.convEmptyToday.style.display = 'none';
      }
      today.forEach(conv => {
        DOM.convListToday.appendChild(buildConvItem(conv));
      });
    }

    /* ── Earlier ── */
    if (DOM.convGroupEarlier) {
      DOM.convGroupEarlier.style.display = earlier.length > 0 ? 'block' : 'none';
    }

    if (DOM.convListEarlier && earlier.length > 0) {
      DOM.convListEarlier.innerHTML = '';
      earlier.forEach(conv => {
        DOM.convListEarlier.appendChild(buildConvItem(conv));
      });
    }
  }

  function buildConvItem(conv) {
    const item = document.createElement('div');
    item.className = `conv-item${conv.id === state.conversationId ? ' active' : ''}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', conv.title);
    item.dataset.id = conv.id;

    const time = _formatTime(conv.timestamp);

    item.innerHTML = `
      <div class="conv-dot"></div>
      <span class="conv-title" title="${_escapeHtml(conv.title)}">
        ${_escapeHtml(conv.title)}
      </span>
      <span class="conv-time">${time}</span>
      <button class="conv-delete-btn" aria-label="Delete conversation" data-id="${conv.id}">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <line x1="2" y1="2" x2="8" y2="8"/>
          <line x1="8" y1="2" x2="2" y2="8"/>
        </svg>
      </button>
    `;

    /* Click: load conversation */
    item.addEventListener('click', (e) => {
      if (e.target.closest('.conv-delete-btn')) return;
      loadConversation(conv.id);
    });

    /* Keyboard: Enter to load */
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadConversation(conv.id);
    });

    /* Delete button */
    item.querySelector('.conv-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    return item;
  }

  function filterConversations(query) {
    renderConversationList(query);
  }

  /* ─────────────────────────────────────────────────────────
     10. WELCOME SCREEN TOGGLE
     ───────────────────────────────────────────────────────── */

  function showWelcome() {
    if (!DOM.welcome) return;
    DOM.welcome.style.display    = 'flex';
    DOM.welcome.setAttribute('aria-hidden', 'false');
    /* Re-stagger chips */
    DOM.welcome.querySelectorAll('.chip').forEach((chip, i) => {
      chip.style.setProperty('--chip-i', i);
    });
  }

  function hideWelcome() {
    if (!DOM.welcome) return;
    if (DOM.welcome.style.display === 'none') return;
    DOM.welcome.style.display = 'none';
    DOM.welcome.setAttribute('aria-hidden', 'true');
  }

  /* ─────────────────────────────────────────────────────────
     11. HEADER TITLE
     ───────────────────────────────────────────────────────── */

  function setHeaderTitle(title) {
    if (DOM.headerTitle) {
      DOM.headerTitle.textContent = title;
      DOM.headerTitle.title       = title;
    }
  }

  /* ─────────────────────────────────────────────────────────
     12. UTILS
     ───────────────────────────────────────────────────────── */

  function _formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }

    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────
     13. ENTRY POINT
     ───────────────────────────────────────────────────────── */

  return { boot };

})();


/* ─────────────────────────────────────────────────────────────
   BOOT — run when DOM is ready
   ───────────────────────────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASApp.boot);
} else {
  ALTASApp.boot();
}
