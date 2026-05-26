/* ═══════════════════════════════════════════════════════════════
   ALTAS — SLASH.JS
   Slash command system · Keyboard navigation · Filtering
   Active command chip · Argument forms · Input intercept
   Depends on: ui.js · api.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASSlash = (() => {

  /* ─────────────────────────────────────────────────────────
     1. COMMAND REGISTRY
     Each command: id, trigger, label, description, icon SVG,
     placeholder for args, section group, optional argForm
     ───────────────────────────────────────────────────────── */

  const COMMANDS = [

    /* ── AI + Knowledge ── */
    {
      id:          'search',
      trigger:     '/search',
      label:       '/search',
      description: 'Search the web for current information',
      section:     'AI + Knowledge',
      placeholder: 'what are you searching for?',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="6" r="4"/><line x1="9.5" y1="9.5" x2="13" y2="13"/>
      </svg>`,
      buildPrompt: (args) =>
        args
          ? `Search the web for: ${args}. Use the web_search tool.`
          : `Please search the web for the following: `,
    },

    {
      id:          'summarize',
      trigger:     '/summarize',
      label:       '/summarize',
      description: 'Summarise a URL or pasted text',
      section:     'AI + Knowledge',
      placeholder: 'paste a URL or text to summarise…',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="1" width="12" height="12" rx="2"/>
        <line x1="4" y1="5" x2="10" y2="5"/>
        <line x1="4" y1="7.5" x2="8" y2="7.5"/>
        <line x1="4" y1="10" x2="6" y2="10"/>
      </svg>`,
      buildPrompt: (args) =>
        args
          ? `Summarise this: ${args}. Use the summarize_document tool with style: brief.`
          : `Summarise the following URL or text: `,
    },

    /* ── Code ── */
    {
      id:          'run',
      trigger:     '/run',
      label:       '/run',
      description: 'Execute code in a sandboxed environment',
      section:     'Code',
      placeholder: 'python · javascript · bash · typescript',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="2,4 6,7 2,10"/>
        <line x1="8" y1="10" x2="12" y2="10"/>
      </svg>`,
      buildPrompt: (args) => {
        const parts  = args ? args.trim().split(' ') : [];
        const lang   = parts[0] || '';
        const code   = parts.slice(1).join(' ');
        if (lang && code) {
          return `Run this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\`\nUse the run_code tool.`;
        }
        if (lang) {
          return `Run the following ${lang} code using the run_code tool:\n\`\`\`${lang}\n`;
        }
        return `Please run the following code using the run_code tool. Specify the language first: `;
      },
    },

    /* ── Calendar ── */
    {
      id:          'add-event',
      trigger:     '/add event',
      label:       '/add event',
      description: 'Add an event to your calendar',
      section:     'Calendar',
      placeholder: 'e.g. Team standup tomorrow 9am for 30 minutes',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="2" width="12" height="11" rx="1.5"/>
        <line x1="1" y1="6" x2="13" y2="6"/>
        <line x1="4" y1="1" x2="4" y2="3"/>
        <line x1="10" y1="1" x2="10" y2="3"/>
        <line x1="7" y1="9" x2="7" y2="11"/>
        <line x1="6" y1="10" x2="8" y2="10"/>
      </svg>`,
      hasArgForm:  true,
      buildPrompt: (args) =>
        args
          ? `Create a calendar event with these details: ${args}. Use the calendar_action tool with action: create_event. Parse the date, time and title from the details.`
          : `Create a calendar event. Use the calendar_action tool with action: create_event. Ask me for the event details.`,
      argForm: {
        title: 'Quick add event',
        fields: [
          { id: 'event-title',    label: 'Event title',  type: 'text',     placeholder: 'Team standup',           required: true  },
          { id: 'event-date',     label: 'Date',         type: 'date',     placeholder: '',                       required: true  },
          { id: 'event-time',     label: 'Start time',   type: 'time',     placeholder: '',                       required: false },
          { id: 'event-duration', label: 'Duration',     type: 'text',     placeholder: '30 minutes / 1 hour',    required: false },
          { id: 'event-location', label: 'Location',     type: 'text',     placeholder: 'Zoom / Office / Online', required: false },
          { id: 'event-notes',    label: 'Notes',        type: 'textarea', placeholder: 'Any additional details', required: false },
        ],
        buildPrompt: (values) => {
          const parts = [];
          if (values['event-title'])    parts.push(`Title: ${values['event-title']}`);
          if (values['event-date'])     parts.push(`Date: ${values['event-date']}`);
          if (values['event-time'])     parts.push(`Time: ${values['event-time']}`);
          if (values['event-duration']) parts.push(`Duration: ${values['event-duration']}`);
          if (values['event-location']) parts.push(`Location: ${values['event-location']}`);
          if (values['event-notes'])    parts.push(`Notes: ${values['event-notes']}`);
          return `Create a calendar event with these details:\n${parts.join('\n')}\n\nUse the calendar_action tool with action: create_event.`;
        },
      },
    },

    {
      id:          'list-events',
      trigger:     '/list events',
      label:       '/list events',
      description: 'Show upcoming calendar events',
      section:     'Calendar',
      placeholder: 'e.g. today · this week · next 7 days',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="2" width="12" height="11" rx="1.5"/>
        <line x1="1" y1="6" x2="13" y2="6"/>
        <line x1="4" y1="1" x2="4" y2="3"/>
        <line x1="10" y1="1" x2="10" y2="3"/>
        <line x1="4" y1="9" x2="10" y2="9"/>
      </svg>`,
      buildPrompt: (args) =>
        `List my calendar events${args ? ` for ${args}` : ' for today'}. Use the calendar_action tool with action: list_events.`,
    },

    /* ── Files ── */
    {
      id:          'add-file',
      trigger:     '/add file',
      label:       '/add file',
      description: 'Read a file from the filesystem',
      section:     'Files',
      placeholder: '/path/to/file.py',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1H3a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L8 1z"/>
        <path d="M8 1v5h4"/>
        <line x1="5" y1="9" x2="9" y2="9"/>
      </svg>`,
      buildPrompt: (args) =>
        args
          ? `Read the file at path: ${args}. Use the read_file tool, then show me its contents and offer to help with it.`
          : `Please read a file from my filesystem. Use the read_file tool. Which file path should I use?`,
    },

    /* ── Memory ── */
    {
      id:          'remember',
      trigger:     '/remember',
      label:       '/remember',
      description: 'Save something to ALTAS memory',
      section:     'Memory',
      placeholder: 'key: value  e.g.  project: ALTAS',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="3" width="12" height="8" rx="1.5"/>
        <circle cx="4" cy="7" r="1"/>
        <circle cx="7" cy="7" r="1"/>
        <circle cx="10" cy="7" r="1"/>
      </svg>`,
      buildPrompt: (args) => {
        if (!args) return `Save this to memory using the memory_store tool. What would you like me to remember? `;
        /* Try to parse "key: value" or "key value" */
        const colonIdx = args.indexOf(':');
        if (colonIdx > 0) {
          const key = args.slice(0, colonIdx).trim().replace(/\s+/g, '_').toLowerCase();
          const val = args.slice(colonIdx + 1).trim();
          return `Remember this: key="${key}", value="${val}". Use the memory_store tool to save it.`;
        }
        const words = args.trim().split(' ');
        const key   = words[0].toLowerCase();
        const val   = words.slice(1).join(' ') || args;
        return `Remember this: key="${key}", value="${val}". Use the memory_store tool to save it.`;
      },
    },

    {
      id:          'recall',
      trigger:     '/recall',
      label:       '/recall',
      description: 'Retrieve something from ALTAS memory',
      section:     'Memory',
      placeholder: 'key, tag, or search term',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 7a6 6 0 1012 0A6 6 0 001 7z"/>
        <path d="M7 4v3l2 2"/>
      </svg>`,
      buildPrompt: (args) =>
        args
          ? `Recall from memory: "${args}". Use the memory_recall tool with key or query: "${args}".`
          : `What would you like me to recall from memory? Use the memory_recall tool. `,
    },

    /* ── Integrations ── */
    {
      id:          'github',
      trigger:     '/github',
      label:       '/github',
      description: 'Interact with your GitHub repos',
      section:     'Integrations',
      placeholder: 'list repos · issues owner/repo · commits owner/repo',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 1C3.69 1 1 3.69 1 7c0 2.65 1.72 4.9 4.1 5.69.3.06.41-.13.41-.29v-1.01c-1.66.36-2.01-.8-2.01-.8-.27-.69-.67-.87-.67-.87-.55-.37.04-.36.04-.36.6.04.92.62.92.62.54.92 1.41.65 1.76.5.05-.39.21-.65.38-.8-1.33-.15-2.72-.66-2.72-2.96 0-.65.23-1.19.62-1.6-.06-.15-.27-.76.06-1.59 0 0 .51-.16 1.66.62A5.8 5.8 0 017 4.37c.51.002 1.03.07 1.51.2 1.15-.78 1.66-.62 1.66-.62.33.83.12 1.44.06 1.59.39.42.62.95.62 1.6 0 2.31-1.4 2.81-2.74 2.96.22.19.41.56.41 1.13v1.68c0 .16.11.35.41.29C11.28 11.9 13 9.65 13 7c0-3.31-2.69-6-6-6z"/>
      </svg>`,
      buildPrompt: (args) => {
        if (!args) return `What would you like to do on GitHub? Use the github_action tool. Available actions: list_repos, get_issue, create_issue, list_prs, get_file, get_commits.`;
        const lower = args.toLowerCase();
        if (lower.startsWith('list repos'))   return `List my GitHub repositories. Use the github_action tool with action: list_repos.`;
        if (lower.startsWith('issues'))       return `Get GitHub issues for: ${args.replace(/^issues\s*/i, '')}. Use the github_action tool with action: get_issue.`;
        if (lower.startsWith('commits'))      return `Get recent commits for: ${args.replace(/^commits\s*/i, '')}. Use the github_action tool with action: get_commits.`;
        if (lower.startsWith('prs'))          return `List pull requests for: ${args.replace(/^prs\s*/i, '')}. Use the github_action tool with action: list_prs.`;
        return `Perform GitHub action: ${args}. Use the github_action tool appropriately.`;
      },
    },

    {
      id:          'notify',
      trigger:     '/notify',
      label:       '/notify',
      description: 'Send yourself a notification or reminder',
      section:     'Integrations',
      placeholder: 'your message here',
      icon: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 1a5 5 0 015 5v3l1 1H1l1-1V6a5 5 0 015-5z"/>
        <line x1="7" y1="13" x2="7" y2="13" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
      buildPrompt: (args) =>
        args
          ? `Send me a notification with this message: "${args}". Use the send_notification tool with channel: push.`
          : `What notification would you like to send? Use the send_notification tool. `,
    },

  ];

  /* ─────────────────────────────────────────────────────────
     2. STATE
     ───────────────────────────────────────────────────────── */

  const state = {
    open:          false,
    focusedIdx:    -1,
    filtered:      [...COMMANDS],
    activeCommand: null,   /* Currently selected command object */
    query:         '',     /* Text after "/" for filtering */
  };

  /* ─────────────────────────────────────────────────────────
     3. DOM REFS
     ───────────────────────────────────────────────────────── */

  let input        = null;
  let dropdown     = null;
  let commandList  = null;
  let inputShell   = null;
  let activeChip   = null;   /* The chip element in the input shell */

  /* ─────────────────────────────────────────────────────────
     4. INIT
     ───────────────────────────────────────────────────────── */

  function init() {
    input       = document.getElementById('prompt-input');
    dropdown    = document.getElementById('slash-dropdown');
    commandList = document.getElementById('slash-command-list');
    inputShell  = document.getElementById('input-shell');

    if (!input || !dropdown) return;

    /* Render full command list initially */
    renderCommandList(COMMANDS);

    /* Wire events */
    input.addEventListener('input',   onInput);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('blur',    onBlur);
    input.addEventListener('focus',   onFocus);

    /* Close dropdown on click outside */
    document.addEventListener('mousedown', (e) => {
      if (!dropdown.contains(e.target) && e.target !== input) {
        close();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     5. INPUT HANDLER
     Detects "/" at start, filters commands as user types,
     closes when "/" is deleted
     ───────────────────────────────────────────────────────── */

  function onInput() {
    const val = input.value;

    /* If an active command chip is present, don't intercept */
    if (state.activeCommand) return;

    /* Detect "/" at start of input */
    if (val.startsWith('/')) {
      const query = val.slice(1).toLowerCase();
      state.query = query;

      if (!state.open) open();

      /* Filter commands */
      const filtered = COMMANDS.filter(cmd => {
        const searchable = `${cmd.trigger} ${cmd.label} ${cmd.description}`.toLowerCase();
        return searchable.includes(query);
      });

      state.filtered   = filtered;
      state.focusedIdx = filtered.length > 0 ? 0 : -1;

      renderCommandList(filtered, query);
      inputShell.classList.add('slash-mode');
    } else {
      /* "/" removed — close */
      if (state.open) close();
      inputShell.classList.remove('slash-mode');
    }
  }

  function onFocus() {
    /* Re-open if value starts with "/" and no active command */
    if (input.value.startsWith('/') && !state.activeCommand) {
      onInput();
    }
  }

  function onBlur(e) {
    /* Don't close if focus moves to dropdown */
    if (dropdown.contains(e.relatedTarget)) return;
    setTimeout(() => {
      if (!dropdown.matches(':focus-within')) close();
    }, 150);
  }

  /* ─────────────────────────────────────────────────────────
     6. KEYBOARD HANDLER
     ↑↓ navigate · Enter select · Escape close · Tab select
     ───────────────────────────────────────────────────────── */

  function onKeyDown(e) {
    /* Dismiss active chip on backspace when input is empty */
    if (e.key === 'Backspace' && state.activeCommand && input.value === '') {
      e.preventDefault();
      dismissActiveCommand();
      return;
    }

    if (!state.open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(1);
        break;

      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        break;

      case 'Enter':
        if (state.focusedIdx >= 0 && state.filtered[state.focusedIdx]) {
          e.preventDefault();
          selectCommand(state.filtered[state.focusedIdx]);
        }
        break;

      case 'Tab':
        if (state.focusedIdx >= 0 && state.filtered[state.focusedIdx]) {
          e.preventDefault();
          selectCommand(state.filtered[state.focusedIdx]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  }

  /* ─────────────────────────────────────────────────────────
     7. FOCUS NAVIGATION
     ───────────────────────────────────────────────────────── */

  function moveFocus(direction) {
    const max = state.filtered.length - 1;
    if (max < 0) return;

    state.focusedIdx = Math.max(0, Math.min(max, state.focusedIdx + direction));
    updateFocusedItem();
  }

  function updateFocusedItem() {
    if (!commandList) return;
    const items = commandList.querySelectorAll('.slash-command-item');

    items.forEach((item, i) => {
      const focused = i === state.focusedIdx;
      item.classList.toggle('focused', focused);
      item.setAttribute('aria-selected', String(focused));
      if (focused) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     8. OPEN / CLOSE DROPDOWN
     ───────────────────────────────────────────────────────── */

  function open() {
    state.open = true;
    dropdown.classList.add('visible');
    dropdown.setAttribute('aria-hidden', 'false');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'slash-dropdown');
  }

  function close() {
    state.open       = false;
    state.focusedIdx = -1;
    state.query      = '';
    dropdown.classList.remove('visible');
    dropdown.setAttribute('aria-hidden', 'true');
    input.setAttribute('aria-expanded', 'false');
    inputShell.classList.remove('slash-mode');
  }

  /* ─────────────────────────────────────────────────────────
     9. SELECT COMMAND
     Replaces "/" text, injects chip, sets placeholder,
     optionally shows arg form
     ───────────────────────────────────────────────────────── */

  function selectCommand(cmd) {
    state.activeCommand = cmd;
    close();

    /* Clear the "/" from the input */
    input.value = '';

    /* Set arg placeholder */
    input.placeholder = cmd.placeholder || `${cmd.label} — type your input…`;
    input.classList.add('has-slash-command');

    /* Inject active chip into input shell */
    _injectCommandChip(cmd);

    /* If command has an arg form, render it above input */
    if (cmd.hasArgForm && cmd.argForm) {
      _renderArgForm(cmd);
    }

    /* Focus back to input */
    input.focus();

    /* Fire ALTAS event so app.js can listen */
    document.dispatchEvent(new CustomEvent('altas:slash-command-selected', {
      detail: { command: cmd },
    }));
  }

  /* ─────────────────────────────────────────────────────────
     10. COMMAND CHIP INJECTION
     ───────────────────────────────────────────────────────── */

  function _injectCommandChip(cmd) {
    /* Remove any existing chip */
    _removeChip();

    activeChip = document.createElement('div');
    activeChip.className = 'slash-active-chip';
    activeChip.setAttribute('aria-label', `Active command: ${cmd.label}`);
    activeChip.dataset.cmdId = cmd.id;

    activeChip.innerHTML = `
      <span class="slash-active-chip-icon" aria-hidden="true">${cmd.icon}</span>
      <span class="slash-active-chip-name">${cmd.label}</span>
      <button
        class="slash-active-chip-dismiss"
        aria-label="Remove ${cmd.label} command"
        tabindex="-1"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="1" y1="1" x2="7" y2="7"/>
          <line x1="7" y1="1" x2="1" y2="7"/>
        </svg>
      </button>
    `;

    /* Dismiss on X click */
    activeChip.querySelector('.slash-active-chip-dismiss')
      .addEventListener('mousedown', (e) => {
        e.preventDefault();
        dismissActiveCommand();
      });

    /* Prepend chip inside shell before the textarea */
    inputShell.insertBefore(activeChip, input);
    inputShell.classList.add('has-command-chip', 'slash-mode');
  }

  /* ─────────────────────────────────────────────────────────
     11. ARG FORM RENDERER
     For commands with structured input (add event)
     ───────────────────────────────────────────────────────── */

  function _renderArgForm(cmd) {
    /* Remove any existing form */
    const existing = document.getElementById('slash-arg-form');
    if (existing) existing.remove();

    const form = document.createElement('div');
    form.className = 'slash-arg-form';
    form.id        = 'slash-arg-form';
    form.setAttribute('aria-label', `${cmd.label} argument form`);

    const title = document.createElement('div');
    title.className   = 'slash-arg-form-title';
    title.textContent = cmd.argForm.title;
    form.appendChild(title);

    /* Build fields */
    cmd.argForm.fields.forEach(field => {
      const row = document.createElement('div');
      row.className = 'slash-arg-row';

      const label = document.createElement('label');
      label.className  = 'slash-arg-label';
      label.textContent = field.label + (field.required ? ' *' : '');
      label.htmlFor     = `slash-field-${field.id}`;
      row.appendChild(label);

      let inputEl;
      if (field.type === 'textarea') {
        inputEl = document.createElement('textarea');
        inputEl.rows = 2;
      } else {
        inputEl = document.createElement('input');
        inputEl.type = field.type;
      }

      inputEl.id          = `slash-field-${field.id}`;
      inputEl.className   = 'slash-arg-input';
      inputEl.placeholder = field.placeholder || '';

      if (field.required) {
        inputEl.required = true;
        inputEl.dataset.cursor = 'text';
      }

      row.appendChild(inputEl);
      form.appendChild(row);
    });

    /* Submit button */
    const submitBtn = document.createElement('button');
    submitBtn.className   = 'slash-arg-submit';
    submitBtn.textContent = 'Add event';
    submitBtn.type        = 'button';

    submitBtn.addEventListener('click', () => {
      _submitArgForm(cmd, form);
    });

    form.appendChild(submitBtn);

    /* Insert form above the input shell */
    const inputZoneInner = document.querySelector('.input-zone-inner');
    if (inputZoneInner) {
      inputZoneInner.insertBefore(form, document.getElementById('input-shell'));
    }

    /* Focus first field */
    const firstInput = form.querySelector('.slash-arg-input');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  function _submitArgForm(cmd, form) {
    /* Collect field values */
    const values = {};
    form.querySelectorAll('.slash-arg-input').forEach(el => {
      const fieldId = el.id.replace('slash-field-', '');
      values[fieldId] = el.value.trim();
    });

    /* Validate required fields */
    const requiredFields = cmd.argForm.fields.filter(f => f.required);
    const missing = requiredFields.filter(f => !values[f.id]);
    if (missing.length > 0) {
      ALTAS.Toast.error(`Please fill in: ${missing.map(f => f.label).join(', ')}`);
      return;
    }

    /* Build prompt from form values */
    const prompt = cmd.argForm.buildPrompt(values);

    /* Remove form */
    form.remove();

    /* Clear command state and submit */
    dismissActiveCommand(false);
    _dispatchPrompt(prompt);
  }

  /* ─────────────────────────────────────────────────────────
     12. DISMISS ACTIVE COMMAND
     ───────────────────────────────────────────────────────── */

  function dismissActiveCommand(refocus = true) {
    if (!state.activeCommand) return;

    /* Remove chip with animation */
    if (activeChip) {
      activeChip.classList.add('dismissing');
      activeChip.addEventListener('animationend', () => {
        activeChip?.remove();
        activeChip = null;
      }, { once: true });
    }

    /* Remove arg form if present */
    document.getElementById('slash-arg-form')?.remove();

    /* Reset input */
    input.placeholder = 'Ask ALTAS anything…';
    input.classList.remove('has-slash-command');
    inputShell.classList.remove('has-command-chip', 'slash-mode');

    state.activeCommand = null;

    if (refocus) input.focus();

    document.dispatchEvent(new CustomEvent('altas:slash-command-dismissed'));
  }

  function _removeChip() {
    if (activeChip) {
      activeChip.remove();
      activeChip = null;
    }
  }

  /* ─────────────────────────────────────────────────────────
     13. BUILD FINAL PROMPT
     Called when user presses Enter with an active command.
     Intercepts the submit in app.js via the event.
     ───────────────────────────────────────────────────────── */

  function buildFinalPrompt(rawInput) {
    if (!state.activeCommand) return rawInput;

    const cmd    = state.activeCommand;
    const args   = rawInput.trim();
    const prompt = cmd.buildPrompt(args);

    dismissActiveCommand(false);
    return prompt;
  }

  function _dispatchPrompt(prompt) {
    document.dispatchEvent(new CustomEvent('altas:slash-submit', {
      detail: { prompt },
    }));
  }

  /* ─────────────────────────────────────────────────────────
     14. RENDER COMMAND LIST
     Builds the dropdown items with optional filter highlighting
     Groups by section
     ───────────────────────────────────────────────────────── */

  function renderCommandList(commands, query = '') {
    if (!commandList) return;
    commandList.innerHTML = '';

    if (commands.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'slash-dropdown-empty';
      empty.textContent = `No commands match "${query}"`;
      commandList.appendChild(empty);
      return;
    }

    /* Group by section */
    const sections = {};
    commands.forEach(cmd => {
      const sec = cmd.section || 'General';
      if (!sections[sec]) sections[sec] = [];
      sections[sec].push(cmd);
    });

    let globalIdx = 0;

    Object.entries(sections).forEach(([sectionName, cmds]) => {
      /* Section label */
      const sectionEl = document.createElement('div');
      sectionEl.className   = 'slash-command-section';
      sectionEl.textContent = sectionName;
      commandList.appendChild(sectionEl);

      /* Items */
      cmds.forEach(cmd => {
        const item = _buildCommandItem(cmd, query, globalIdx);
        commandList.appendChild(item);
        globalIdx++;
      });
    });

    /* Apply initial focus */
    updateFocusedItem();
  }

  function _buildCommandItem(cmd, query, idx) {
    const item = document.createElement('div');
    item.className        = `slash-command-item${idx === state.focusedIdx ? ' focused' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(idx === state.focusedIdx));
    item.setAttribute('tabindex', '-1');
    item.dataset.idx      = idx;
    item.dataset.cmd      = cmd.id;

    /* Highlight matching query in label */
    const highlightedLabel = query
      ? cmd.label.replace(new RegExp(`(${_escapeRegex(query)})`, 'gi'),
          '<mark>$1</mark>')
      : cmd.label;

    item.innerHTML = `
      <div class="slash-command-icon" aria-hidden="true">${cmd.icon}</div>
      <div class="slash-command-text">
        <div class="slash-command-name">${highlightedLabel}</div>
        <div class="slash-command-desc">${_escapeHtml(cmd.description)}</div>
      </div>
      <span class="slash-command-shortcut" aria-hidden="true">↵</span>
    `;

    /* Click to select */
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); /* Prevent input blur */
      state.focusedIdx = idx;
      selectCommand(cmd);
    });

    /* Hover to focus */
    item.addEventListener('mouseenter', () => {
      state.focusedIdx = idx;
      updateFocusedItem();
    });

    return item;
  }

  /* ─────────────────────────────────────────────────────────
     15. UTILS
     ───────────────────────────────────────────────────────── */

  function _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ─────────────────────────────────────────────────────────
     16. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    init,
    open,
    close,
    selectCommand,
    dismissActiveCommand,
    buildFinalPrompt,
    isActive:       () => !!state.activeCommand,
    activeCommand:  () => state.activeCommand,
    COMMANDS,
  };

})();

/* ─────────────────────────────────────────────────────────────
   WIRE INTO APP.JS SUBMIT FLOW
   app.js's submitMessage calls ALTASSlash.buildFinalPrompt()
   before sending — this intercepts slash commands transparently.
   Also listens for altas:slash-submit from arg forms.
   ───────────────────────────────────────────────────────────── */

document.addEventListener('altas:slash-submit', (e) => {
  /* Arg form submitted — fire directly into chat */
  const prompt = e.detail?.prompt;
  if (!prompt) return;

  /* Dispatch as if user typed it — app.js picks this up */
  document.dispatchEvent(new CustomEvent('altas:external-prompt', {
    detail: { prompt },
  }));
});

/* Auto-init */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASSlash.init);
} else {
  ALTASSlash.init();
}
