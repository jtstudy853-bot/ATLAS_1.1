/* ═══════════════════════════════════════════════════════════════
   ALTAS — MEMORY.JS
   Memory CRUD · Search · Tag filtering · Edit modal
   Import / Export · Sidebar panel · Auto-sync with tool calls
   Depends on: ui.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASMemory = (() => {

  /* ─────────────────────────────────────────────────────────
     1. STATE
     ───────────────────────────────────────────────────────── */

  const state = {
    entries:       [],      /* All memory entries                  */
    filtered:      [],      /* Currently displayed (after filter)  */
    activeTag:     null,    /* Currently selected tag filter       */
    searchQuery:   '',      /* Current search string               */
    editingEntry:  null,    /* Entry being edited in modal         */
    sortOrder:     'newest', /* newest | oldest | alpha            */
    editTags:      [],      /* Tags being built in edit modal      */
  };

  /* ─────────────────────────────────────────────────────────
     2. DOM REFS
     ───────────────────────────────────────────────────────── */

  const DOM = {};

  function cacheDOM() {
    DOM.panel          = document.getElementById('panel-memory');
    DOM.searchInput    = document.getElementById('memory-search-input');
    DOM.searchClear    = document.getElementById('memory-search-clear');
    DOM.tagFilter      = document.getElementById('memory-tag-filter');
    DOM.list           = document.getElementById('memory-list');
    DOM.statsCount     = document.getElementById('memory-stats-count');
    DOM.sortBtn        = document.getElementById('memory-sort-btn');
    DOM.addBtn         = document.getElementById('memory-add-btn');
    DOM.totalBadge     = document.getElementById('memory-total-badge');
    DOM.exportBtn      = document.getElementById('memory-export-btn');
    DOM.importBtn      = document.getElementById('memory-import-btn');
    DOM.importInput    = document.getElementById('memory-import-input');

    /* Edit modal */
    DOM.editModal      = document.getElementById('memory-edit-modal');
    DOM.editBackdrop   = DOM.editModal?.querySelector('.memory-edit-backdrop');
    DOM.editTitle      = document.getElementById('memory-edit-title');
    DOM.editKeyInput   = document.getElementById('memory-edit-key');
    DOM.editValueInput = document.getElementById('memory-edit-value');
    DOM.tagsWrap       = document.getElementById('memory-tags-wrap');
    DOM.tagsTextInput  = document.getElementById('memory-tags-input');
    DOM.btnSave        = document.getElementById('memory-btn-save');
    DOM.btnCancel      = document.getElementById('memory-btn-cancel');
    DOM.btnDelete      = document.getElementById('memory-btn-delete');
  }

  /* ─────────────────────────────────────────────────────────
     3. INIT
     ───────────────────────────────────────────────────────── */

  function init() {
    cacheDOM();
    loadEntries();
    wireEvents();
    renderAll();

    /* Listen for tool-call memory events from api.js / chat.js */
    document.addEventListener('altas:memory-stored',  onMemoryStored);
    document.addEventListener('altas:memory-recalled', onMemoryRecalled);
  }

  /* ─────────────────────────────────────────────────────────
     4. EVENT WIRING
     ───────────────────────────────────────────────────────── */

  function wireEvents() {

    /* Search */
    DOM.searchInput?.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });

    DOM.searchClear?.addEventListener('click', () => {
      if (DOM.searchInput) DOM.searchInput.value = '';
      state.searchQuery = '';
      applyFilters();
    });

    /* Sort */
    DOM.sortBtn?.addEventListener('click', () => {
      const orders = ['newest', 'oldest', 'alpha'];
      const idx = orders.indexOf(state.sortOrder);
      state.sortOrder = orders[(idx + 1) % orders.length];
      if (DOM.sortBtn) DOM.sortBtn.title = `Sort: ${state.sortOrder}`;
      applyFilters();
    });

    /* Add new */
    DOM.addBtn?.addEventListener('click', () => openEditModal(null));

    /* Export */
    DOM.exportBtn?.addEventListener('click', exportMemory);

    /* Import */
    DOM.importBtn?.addEventListener('click', () => DOM.importInput?.click());
    DOM.importInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) importMemory(file);
      e.target.value = '';
    });

    /* Edit modal */
    DOM.btnCancel?.addEventListener('click',  closeEditModal);
    DOM.editBackdrop?.addEventListener('click', closeEditModal);
    DOM.btnSave?.addEventListener('click',   saveEntry);
    DOM.btnDelete?.addEventListener('click', deleteEditingEntry);

    /* Tags input — add tag on Enter or comma */
    DOM.tagsTextInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = DOM.tagsTextInput.value.trim().replace(/,/g, '');
        if (tag) addEditTag(tag);
        DOM.tagsTextInput.value = '';
      }
      if (e.key === 'Backspace' && !DOM.tagsTextInput.value) {
        state.editTags.pop();
        renderEditTags();
      }
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && DOM.editModal && !DOM.editModal.hidden) {
        closeEditModal();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     5. STORAGE
     ───────────────────────────────────────────────────────── */

  function loadEntries() {
    try {
      const raw = localStorage.getItem('altas_memory');
      state.entries = raw ? JSON.parse(raw) : [];
    } catch {
      state.entries = [];
    }
  }

  function saveEntries() {
    try {
      localStorage.setItem('altas_memory', JSON.stringify(state.entries));
    } catch (e) {
      console.warn('ALTAS Memory: Could not save', e);
      ALTAS.Toast.error('Memory storage full — please export and clear some entries');
    }
  }

  /* ─────────────────────────────────────────────────────────
     6. CRUD
     ───────────────────────────────────────────────────────── */

  /* Called by tool handler or manually */
  function store(key, value, tags = []) {
    if (!key || value === undefined) return;

    const existing = state.entries.findIndex(e => e.key === key);
    const entry = {
      id:        existing >= 0 ? state.entries[existing].id : `mem_${Date.now()}`,
      key:       key.trim().replace(/\s+/g, '_').toLowerCase(),
      value:     String(value),
      tags:      Array.isArray(tags) ? tags.map(t => t.toLowerCase().trim()) : [],
      createdAt: existing >= 0 ? state.entries[existing].createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    if (existing >= 0) {
      state.entries[existing] = entry;
    } else {
      state.entries.unshift(entry);
    }

    saveEntries();
    renderAll();

    /* Notify sidebar tab if visible */
    if (DOM.totalBadge) {
      DOM.totalBadge.textContent = `${state.entries.length} entries`;
    }

    return entry;
  }

  function recall(keyOrTag) {
    if (!keyOrTag) return state.entries;

    const q = keyOrTag.toLowerCase().trim();
    return state.entries.filter(e =>
      e.key.includes(q) ||
      e.tags.some(t => t.includes(q)) ||
      e.value.toLowerCase().includes(q)
    );
  }

  function deleteEntry(id) {
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;

    state.entries = state.entries.filter(e => e.id !== id);
    saveEntries();
    renderAll();
    ALTAS.Toast.info(`Memory "${entry.key}" deleted`);
  }

  function updateEntry(id, { key, value, tags }) {
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;

    if (key)   entry.key   = key.trim().replace(/\s+/g, '_').toLowerCase();
    if (value !== undefined) entry.value = String(value);
    if (tags)  entry.tags  = tags.map(t => t.toLowerCase().trim());
    entry.updatedAt = Date.now();

    saveEntries();
    renderAll();
  }

  /* ─────────────────────────────────────────────────────────
     7. TOOL CALL EVENT HANDLERS
     Fires when api.js detects memory_store / memory_recall
     ───────────────────────────────────────────────────────── */

  function onMemoryStored(e) {
    const { key, value, tags } = e.detail || {};
    if (key && value !== undefined) {
      store(key, value, tags);
    }
  }

  function onMemoryRecalled(e) {
    const { key, tag, query } = e.detail || {};
    const results = recall(key || tag || query || '');
    /* Re-dispatch results for chat.js to render as memory cards */
    document.dispatchEvent(new CustomEvent('altas:memory-results', {
      detail: { results },
    }));
  }

  /* ─────────────────────────────────────────────────────────
     8. FILTER + SORT
     ───────────────────────────────────────────────────────── */

  function applyFilters() {
    let result = [...state.entries];

    /* Tag filter */
    if (state.activeTag) {
      result = result.filter(e => e.tags.includes(state.activeTag));
    }

    /* Search query */
    if (state.searchQuery) {
      const q = state.searchQuery;
      result = result.filter(e =>
        e.key.includes(q) ||
        e.value.toLowerCase().includes(q) ||
        e.tags.some(t => t.includes(q))
      );
    }

    /* Sort */
    switch (state.sortOrder) {
      case 'newest': result.sort((a,b) => b.updatedAt - a.updatedAt); break;
      case 'oldest': result.sort((a,b) => a.updatedAt - b.updatedAt); break;
      case 'alpha':  result.sort((a,b) => a.key.localeCompare(b.key)); break;
    }

    state.filtered = result;
    renderList();
    renderStats();
  }

  /* ─────────────────────────────────────────────────────────
     9. RENDER
     ───────────────────────────────────────────────────────── */

  function renderAll() {
    applyFilters();
    renderTagFilter();
    renderStats();
    if (DOM.totalBadge) {
      DOM.totalBadge.textContent = `${state.entries.length} entries`;
    }
  }

  function renderList() {
    if (!DOM.list) return;
    DOM.list.innerHTML = '';

    if (state.filtered.length === 0) {
      DOM.list.innerHTML = `
        <div class="memory-empty">
          <div class="memory-empty-orb">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
              stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="5" width="16" height="10" rx="2"/>
              <circle cx="6" cy="10" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="14" cy="10" r="1.2" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <div class="memory-empty-title">
            ${state.searchQuery || state.activeTag ? 'No matches' : 'No memories yet'}
          </div>
          <div class="memory-empty-body">
            ${state.searchQuery || state.activeTag
              ? 'Try a different search or tag filter.'
              : 'Use /remember or ask ALTAS to remember something for you.'
            }
          </div>
          ${!state.searchQuery && !state.activeTag ? `
            <div class="memory-empty-hint">/remember key: value</div>
          ` : ''}
        </div>
      `;
      return;
    }

    state.filtered.forEach((entry, i) => {
      const card = _buildEntryCard(entry, i);
      DOM.list.appendChild(card);
    });
  }

  function _buildEntryCard(entry, idx) {
    const card = document.createElement('div');
    card.className = 'memory-entry';
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `Memory: ${entry.key}`);
    card.dataset.id = entry.id;
    card.style.setProperty('--i', idx);

    const timeStr = _formatTime(entry.updatedAt);
    const preview = entry.value.length > 80
      ? entry.value.slice(0, 80) + '…'
      : entry.value;

    const tagsHTML = entry.tags.length > 0
      ? `<div class="memory-entry-tags">
           ${entry.tags.map(t =>
             `<span class="memory-entry-tag">${_escapeHtml(t)}</span>`
           ).join('')}
         </div>`
      : '';

    card.innerHTML = `
      <div class="memory-entry-header">
        <span class="memory-entry-key">${_escapeHtml(entry.key)}</span>
        <span class="memory-entry-timestamp">${timeStr}</span>
      </div>
      <div class="memory-entry-value">${_escapeHtml(preview)}</div>
      ${tagsHTML}
      <div class="memory-entry-actions">
        <button class="memory-entry-btn edit" aria-label="Edit entry">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 1.5L8.5 3 3.5 8H2V6.5L7 1.5z"/>
          </svg>
        </button>
        <button class="memory-entry-btn delete" aria-label="Delete entry">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/>
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/>
          </svg>
        </button>
      </div>
    `;

    /* Click card → open edit modal */
    card.addEventListener('click', (e) => {
      if (e.target.closest('.memory-entry-btn')) return;
      openEditModal(entry);
    });

    /* Edit button */
    card.querySelector('.memory-entry-btn.edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(entry);
    });

    /* Delete button */
    card.querySelector('.memory-entry-btn.delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteEntry(entry.id);
    });

    return card;
  }

  function renderTagFilter() {
    if (!DOM.tagFilter) return;
    DOM.tagFilter.innerHTML = '';

    /* Collect all unique tags */
    const tagMap = {};
    state.entries.forEach(e => {
      e.tags.forEach(t => {
        tagMap[t] = (tagMap[t] || 0) + 1;
      });
    });

    if (Object.keys(tagMap).length === 0) return;

    /* "All" pill */
    const allPill = _buildTagPill('All', state.entries.length, state.activeTag === null);
    allPill.addEventListener('click', () => {
      state.activeTag = null;
      renderTagFilter();
      applyFilters();
    });
    DOM.tagFilter.appendChild(allPill);

    /* Per-tag pills */
    Object.entries(tagMap)
      .sort((a,b) => b[1] - a[1])
      .forEach(([tag, count]) => {
        const pill = _buildTagPill(tag, count, state.activeTag === tag);
        pill.addEventListener('click', () => {
          state.activeTag = state.activeTag === tag ? null : tag;
          renderTagFilter();
          applyFilters();
        });
        DOM.tagFilter.appendChild(pill);
      });
  }

  function _buildTagPill(label, count, isActive) {
    const pill = document.createElement('div');
    pill.className = `memory-tag-pill${isActive ? ' active' : ''}`;
    pill.dataset.tag = label;
    pill.innerHTML = `
      <span class="memory-tag-pill-dot"></span>
      ${_escapeHtml(label)}
      <span class="memory-tag-pill-count">${count}</span>
    `;
    return pill;
  }

  function renderStats() {
    if (!DOM.statsCount) return;
    const total    = state.entries.length;
    const showing  = state.filtered.length;
    DOM.statsCount.textContent = total === showing
      ? `${total} entr${total !== 1 ? 'ies' : 'y'}`
      : `${showing} of ${total}`;
  }

  /* ─────────────────────────────────────────────────────────
     10. EDIT MODAL
     ───────────────────────────────────────────────────────── */

  function openEditModal(entry) {
    if (!DOM.editModal) return;

    state.editingEntry = entry;
    state.editTags     = entry ? [...(entry.tags || [])] : [];

    /* Title */
    if (DOM.editTitle) {
      DOM.editTitle.textContent = entry ? 'Edit memory' : 'Add memory';
    }

    /* Fields */
    if (DOM.editKeyInput)   DOM.editKeyInput.value   = entry?.key   || '';
    if (DOM.editValueInput) DOM.editValueInput.value = entry?.value || '';

    /* Tags */
    renderEditTags();

    /* Delete button — only for existing entries */
    if (DOM.btnDelete) {
      DOM.btnDelete.style.display = entry ? 'flex' : 'none';
    }

    DOM.editModal.hidden = false;
    DOM.editModal.removeAttribute('hidden');

    /* Focus first empty field */
    setTimeout(() => {
      if (!entry || !entry.key) {
        DOM.editKeyInput?.focus();
      } else {
        DOM.editValueInput?.focus();
        DOM.editValueInput?.setSelectionRange(
          DOM.editValueInput.value.length,
          DOM.editValueInput.value.length
        );
      }
    }, 80);
  }

  function closeEditModal() {
    if (!DOM.editModal) return;
    DOM.editModal.hidden = true;
    state.editingEntry = null;
    state.editTags     = [];
  }

  function saveEntry() {
    const key   = DOM.editKeyInput?.value?.trim();
    const value = DOM.editValueInput?.value?.trim();

    if (!key) {
      ALTAS.Toast.error('Key is required');
      DOM.editKeyInput?.focus();
      return;
    }
    if (!value) {
      ALTAS.Toast.error('Value is required');
      DOM.editValueInput?.focus();
      return;
    }

    if (state.editingEntry) {
      /* Update existing */
      updateEntry(state.editingEntry.id, {
        key,
        value,
        tags: state.editTags,
      });
      ALTAS.Toast.success(`Memory "${key}" updated`);
    } else {
      /* Create new */
      store(key, value, state.editTags);
      ALTAS.Toast.success(`Memory "${key}" saved`);
    }

    closeEditModal();
  }

  function deleteEditingEntry() {
    if (!state.editingEntry) return;
    const id  = state.editingEntry.id;
    const key = state.editingEntry.key;
    closeEditModal();
    deleteEntry(id);
    ALTAS.Toast.info(`Memory "${key}" deleted`);
  }

  /* ─────────────────────────────────────────────────────────
     11. TAG EDITING IN MODAL
     ───────────────────────────────────────────────────────── */

  function addEditTag(tag) {
    const clean = tag.toLowerCase().trim();
    if (!clean || state.editTags.includes(clean)) return;
    state.editTags.push(clean);
    renderEditTags();
  }

  function removeEditTag(tag) {
    state.editTags = state.editTags.filter(t => t !== tag);
    renderEditTags();
  }

  function renderEditTags() {
    if (!DOM.tagsWrap) return;

    /* Remove existing chips but keep the text input */
    DOM.tagsWrap.querySelectorAll('.memory-tag-chip').forEach(c => c.remove());

    /* Prepend chips */
    state.editTags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'memory-tag-chip';
      chip.innerHTML = `
        <span>${_escapeHtml(tag)}</span>
        <button class="memory-tag-chip-remove" aria-label="Remove tag ${tag}" type="button">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="1" y1="1" x2="7" y2="7"/>
            <line x1="7" y1="1" x2="1" y2="7"/>
          </svg>
        </button>
      `;
      chip.querySelector('.memory-tag-chip-remove').addEventListener('click', () => {
        removeEditTag(tag);
      });

      DOM.tagsWrap.insertBefore(chip, DOM.tagsTextInput);
    });
  }

  /* ─────────────────────────────────────────────────────────
     12. IMPORT / EXPORT
     ───────────────────────────────────────────────────────── */

  function exportMemory() {
    if (state.entries.length === 0) {
      ALTAS.Toast.error('No memories to export');
      return;
    }

    const data = JSON.stringify({
      version:   '1.0',
      exportedAt: new Date().toISOString(),
      count:     state.entries.length,
      entries:   state.entries,
    }, null, 2);

    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `altas-memory-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    ALTAS.Toast.success(`Exported ${state.entries.length} memories`);
  }

  function importMemory(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const incoming = Array.isArray(data) ? data : (data.entries || []);

        if (!Array.isArray(incoming) || incoming.length === 0) {
          ALTAS.Toast.error('No valid memory entries found in file');
          return;
        }

        let imported = 0;
        incoming.forEach(entry => {
          if (entry.key && entry.value !== undefined) {
            store(entry.key, entry.value, entry.tags || []);
            imported++;
          }
        });

        ALTAS.Toast.success(`Imported ${imported} memories`);
      } catch {
        ALTAS.Toast.error('Could not parse memory file — must be valid JSON');
      }
    };
    reader.readAsText(file);
  }

  /* ─────────────────────────────────────────────────────────
     13. PUBLIC API (used by api.js tool handler + app.js)
     ───────────────────────────────────────────────────────── */

  /* Build a memory context string for system prompt injection */
  function getMemoryContext(limit = 20) {
    if (state.entries.length === 0) return '';

    const recent = [...state.entries]
      .sort((a,b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);

    const lines = recent.map(e => {
      const tags = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
      return `- ${e.key}${tags}: ${e.value}`;
    });

    return `\n\n## ALTAS Memory Bank\nThe following facts have been stored:\n${lines.join('\n')}`;
  }

  /* ─────────────────────────────────────────────────────────
     14. UTILS
     ───────────────────────────────────────────────────────── */

  function _formatTime(ts) {
    if (!ts) return '';
    const d   = new Date(ts);
    const now = new Date();
    const diffMs  = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr  = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr  / 24);

    if (diffMin < 1)   return 'just now';
    if (diffMin < 60)  return `${diffMin}m ago`;
    if (diffHr  < 24)  return `${diffHr}h ago`;
    if (diffDay < 7)   return `${diffDay}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────
     15. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    init,
    store,
    recall,
    deleteEntry,
    updateEntry,
    exportMemory,
    importMemory,
    getMemoryContext,
    openEditModal,
    get entries() { return state.entries; },
    get count()   { return state.entries.length; },
  };

})();

/* Auto-init */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASMemory.init);
} else {
  ALTASMemory.init();
}
