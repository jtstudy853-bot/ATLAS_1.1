/* ═══════════════════════════════════════════════════════════════
   ALTAS — PROJECTS.JS
   Project CRUD · Workspace panel · Tab navigation
   Notes editor · File list · Context injector · Sidebar tabs
   Depends on: ui.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASProjects = (() => {

  /* ─────────────────────────────────────────────────────────
     1. CONSTANTS
     ───────────────────────────────────────────────────────── */

  const PROJECT_COLORS = [
    { hex: '#7B6CFF', label: 'Violet'  },
    { hex: '#4A9EFF', label: 'Blue'    },
    { hex: '#4ECCA3', label: 'Teal'    },
    { hex: '#F2A623', label: 'Amber'   },
    { hex: '#E8593C', label: 'Coral'   },
    { hex: '#C88CFF', label: 'Lavender'},
    { hex: '#FFB43C', label: 'Gold'    },
    { hex: '#FF5050', label: 'Red'     },
  ];

  const PROJECT_ICONS = ['⬡', '◈', '⊹', '⊞', '◎', '⬟', '⊕', '◆', '⟡', '⌬'];

  /* ─────────────────────────────────────────────────────────
     2. STATE
     ───────────────────────────────────────────────────────── */

  const state = {
    projects:          [],      /* All projects array          */
    activeProjectId:   null,    /* Currently loaded project ID */
    workspaceOpen:     false,   /* Workspace panel visible     */
    workspaceTab:      'conversations', /* Active workspace tab */
    newProjectColor:   PROJECT_COLORS[0].hex,
    newProjectIcon:    PROJECT_ICONS[0],
    notesSaveTimer:    null,
    contextSaveTimer:  null,
    sidebarTab:        'chats', /* chats | projects | memory   */
  };

  /* ─────────────────────────────────────────────────────────
     3. DOM REFS
     ───────────────────────────────────────────────────────── */

  const DOM = {};

  function cacheDOM() {
    DOM.projectList          = document.getElementById('project-list');
    DOM.workspace            = document.getElementById('project-workspace');
    DOM.workspaceBackdrop    = DOM.workspace?.querySelector('.project-workspace-backdrop');
    DOM.workspaceName        = document.getElementById('workspace-project-name');
    DOM.workspaceColor       = document.getElementById('workspace-project-color');
    DOM.workspaceClose       = document.getElementById('workspace-close');
    DOM.workspaceTabs        = document.querySelectorAll('.workspace-tab');
    DOM.workspacePanes       = document.querySelectorAll('.workspace-pane');
    DOM.workspaceConvList    = document.getElementById('workspace-conv-list');
    DOM.notesEditor          = document.getElementById('workspace-notes-editor');
    DOM.notesSaveIndicator   = document.getElementById('notes-save-indicator');
    DOM.contextEditor        = document.getElementById('workspace-context-editor');
    DOM.newProjectModal      = document.getElementById('new-project-modal');
    DOM.newProjectBackdrop   = DOM.newProjectModal?.querySelector('.new-project-backdrop');
    DOM.newProjectNameInput  = document.getElementById('new-project-name');
    DOM.newProjectDescInput  = document.getElementById('new-project-desc');
    DOM.colorPicker          = document.getElementById('project-color-picker');
    DOM.iconPicker           = document.getElementById('project-icon-picker');
    DOM.btnCreateProject     = document.getElementById('btn-create-project');
    DOM.btnCancelProject     = document.getElementById('btn-cancel-project');
    DOM.btnNewProject        = document.getElementById('btn-new-project');
    DOM.sidebarNavTabs       = document.querySelectorAll('.sidebar-nav-tab');
    DOM.sidebarPanels        = document.querySelectorAll('.sidebar-panel');
    DOM.activeProjectIndicator = document.getElementById('active-project-indicator');
    DOM.activeProjectDot     = document.getElementById('active-project-dot');
    DOM.activeProjectName    = document.getElementById('active-project-name');
    DOM.fileDropZone         = document.getElementById('workspace-file-drop');
    DOM.fileList             = document.getElementById('workspace-file-list');
    DOM.btnUploadFile        = document.getElementById('btn-upload-file');
    DOM.fileInput            = document.getElementById('workspace-file-input');
  }

  /* ─────────────────────────────────────────────────────────
     4. INIT
     ───────────────────────────────────────────────────────── */

  function init() {
    cacheDOM();
    loadProjects();
    renderColorPicker();
    renderIconPicker();
    wireEvents();
    renderProjectList();
  }

  /* ─────────────────────────────────────────────────────────
     5. EVENT WIRING
     ───────────────────────────────────────────────────────── */

  function wireEvents() {

    /* ── Sidebar nav tabs ── */
    DOM.sidebarNavTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchSidebarTab(tab.dataset.tab);
      });
    });

    /* ── New project button ── */
    DOM.btnNewProject?.addEventListener('click', openNewProjectModal);

    /* ── New project modal ── */
    DOM.btnCancelProject?.addEventListener('click', closeNewProjectModal);
    DOM.newProjectBackdrop?.addEventListener('click', closeNewProjectModal);
    DOM.btnCreateProject?.addEventListener('click', createProject);

    /* Enter key on name input submits */
    DOM.newProjectNameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createProject();
    });

    /* ── Workspace close ── */
    DOM.workspaceClose?.addEventListener('click', closeWorkspace);
    DOM.workspaceBackdrop?.addEventListener('click', closeWorkspace);

    /* ── Workspace tabs ── */
    DOM.workspaceTabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        switchWorkspaceTab(tab.dataset.tab);
      });
    });

    /* ── Notes editor — auto-save on input ── */
    DOM.notesEditor?.addEventListener('input', () => {
      _debouncedSaveNotes();
      if (DOM.notesSaveIndicator) {
        DOM.notesSaveIndicator.textContent = 'Unsaved…';
        DOM.notesSaveIndicator.classList.remove('saved');
      }
    });

    /* ── Context editor — auto-save ── */
    DOM.contextEditor?.addEventListener('input', () => {
      _debouncedSaveContext();
    });

    /* ── Active project indicator in header → open workspace ── */
    DOM.activeProjectIndicator?.addEventListener('click', () => {
      if (state.activeProjectId) openWorkspace(state.activeProjectId);
    });

    /* ── File drop zone ── */
    if (DOM.fileDropZone) {
      DOM.fileDropZone.addEventListener('click', () => DOM.fileInput?.click());
      DOM.fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        DOM.fileDropZone.classList.add('drag-over');
      });
      DOM.fileDropZone.addEventListener('dragleave', () => {
        DOM.fileDropZone.classList.remove('drag-over');
      });
      DOM.fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        DOM.fileDropZone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length > 0) attachFiles(files);
      });
    }

    DOM.fileInput?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) attachFiles(files);
      e.target.value = '';
    });

    DOM.btnUploadFile?.addEventListener('click', () => DOM.fileInput?.click());

    /* ── Escape closes workspace or modal ── */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.workspaceOpen) closeWorkspace();
        else if (!DOM.newProjectModal?.hidden) closeNewProjectModal();
      }
    });

    /* ── Context menu: close on click outside ── */
    document.addEventListener('click', () => {
      document.querySelector('.project-context-menu')?.remove();
    });
  }

  /* ─────────────────────────────────────────────────────────
     6. SIDEBAR TAB SWITCHER
     ───────────────────────────────────────────────────────── */

  function switchSidebarTab(tab) {
    state.sidebarTab = tab;

    DOM.sidebarNavTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
      t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    });

    DOM.sidebarPanels.forEach(p => {
      p.classList.toggle('active', p.id === `panel-${tab}`);
    });

    /* Re-render panel content if switching to projects */
    if (tab === 'projects') renderProjectList();
  }

  /* ─────────────────────────────────────────────────────────
     7. PROJECT CRUD
     ───────────────────────────────────────────────────────── */

  function loadProjects() {
    try {
      const raw = localStorage.getItem('altas_projects');
      state.projects = raw ? JSON.parse(raw) : [];
    } catch {
      state.projects = [];
    }
  }

  function saveProjects() {
    try {
      localStorage.setItem('altas_projects', JSON.stringify(state.projects));
    } catch (e) {
      console.warn('ALTAS Projects: Could not save', e);
    }
  }

  function createProject() {
    const name = DOM.newProjectNameInput?.value?.trim();
    if (!name) {
      ALTAS.Toast.error('Project name is required');
      DOM.newProjectNameInput?.focus();
      return;
    }

    const project = {
      id:           `proj_${Date.now()}`,
      name,
      description:  DOM.newProjectDescInput?.value?.trim() || '',
      color:        state.newProjectColor,
      icon:         state.newProjectIcon,
      conversations: [],
      files:         [],
      notes:         '',
      context:       '',
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
    };

    state.projects.unshift(project);
    saveProjects();
    renderProjectList();
    closeNewProjectModal();
    ALTAS.Toast.success(`Project "${name}" created`);

    /* Auto-open the new project */
    setTimeout(() => openWorkspace(project.id), 300);
  }

  function deleteProject(id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;

    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;

    state.projects = state.projects.filter(p => p.id !== id);
    saveProjects();

    if (state.activeProjectId === id) {
      state.activeProjectId = null;
      _updateActiveProjectIndicator(null);
      if (state.workspaceOpen) closeWorkspace();
    }

    renderProjectList();
    ALTAS.Toast.info(`Project "${project.name}" deleted`);
  }

  function renameProject(id, newName) {
    const project = state.projects.find(p => p.id === id);
    if (!project || !newName.trim()) return;

    project.name      = newName.trim();
    project.updatedAt = Date.now();
    saveProjects();
    renderProjectList();

    /* Update workspace header if open */
    if (DOM.workspaceName && state.workspaceOpen) {
      DOM.workspaceName.textContent = project.name;
    }
  }

  /* ─────────────────────────────────────────────────────────
     8. PROJECT LIST RENDER (sidebar)
     ───────────────────────────────────────────────────────── */

  function renderProjectList() {
    if (!DOM.projectList) return;
    DOM.projectList.innerHTML = '';

    if (state.projects.length === 0) {
      DOM.projectList.innerHTML = `
        <div class="project-list-empty">
          <div class="project-list-empty-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="14" height="11" rx="2"/>
              <path d="M1 7h14"/>
              <path d="M5 3V1M11 3V1"/>
            </svg>
          </div>
          <div class="project-list-empty-text">No projects yet</div>
          <div class="project-list-empty-hint">Click + to create one</div>
        </div>
      `;
      return;
    }

    state.projects.forEach(project => {
      DOM.projectList.appendChild(_buildProjectItem(project));
    });
  }

  function _buildProjectItem(project) {
    const item = document.createElement('div');
    item.className = `project-item${project.id === state.activeProjectId ? ' active' : ''}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', project.name);
    item.dataset.id = project.id;

    const convCount = project.conversations?.length || 0;

    item.innerHTML = `
      <div class="project-color-dot" style="background:${project.color}; color:${project.color}"></div>
      <span class="project-item-name" title="${_escapeHtml(project.name)}">
        ${project.icon ? `<span aria-hidden="true">${project.icon}</span> ` : ''}${_escapeHtml(project.name)}
      </span>
      <span class="project-item-meta">${convCount}</span>
      <button class="project-item-options" aria-label="Project options" tabindex="-1">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="2" cy="6" r="1.2"/>
          <circle cx="6" cy="6" r="1.2"/>
          <circle cx="10" cy="6" r="1.2"/>
        </svg>
      </button>
    `;

    /* Click: open workspace */
    item.addEventListener('click', (e) => {
      if (e.target.closest('.project-item-options')) return;
      openWorkspace(project.id);
    });

    /* Keyboard */
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openWorkspace(project.id);
    });

    /* Options button → context menu */
    item.querySelector('.project-item-options')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, project);
    });

    /* Right-click context menu */
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, project);
    });

    return item;
  }

  /* ─────────────────────────────────────────────────────────
     9. CONTEXT MENU
     ───────────────────────────────────────────────────────── */

  function showContextMenu(e, project) {
    /* Remove any existing context menu */
    document.querySelector('.project-context-menu')?.remove();

    const menu = document.createElement('div');
    menu.className = 'project-context-menu';
    menu.setAttribute('role', 'menu');

    const actions = [
      {
        label: 'Open workspace',
        icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="1" width="10" height="10" rx="1.5"/>
          <path d="M4 6h4M6 4v4"/>
        </svg>`,
        action: () => openWorkspace(project.id),
      },
      {
        label: 'Set as active',
        icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="5"/>
          <path d="M3.5 6l2 2 3-3"/>
        </svg>`,
        action: () => setActiveProject(project.id),
      },
      { type: 'sep' },
      {
        label: 'Rename',
        icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5z"/>
        </svg>`,
        action: () => {
          const newName = prompt('Rename project:', project.name);
          if (newName) renameProject(project.id, newName);
        },
      },
      { type: 'sep' },
      {
        label: 'Delete project',
        icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 3h10M4 3V2h4v1M10 3l-.7 8H2.7L2 3"/>
        </svg>`,
        danger: true,
        action: () => deleteProject(project.id),
      },
    ];

    actions.forEach(a => {
      if (a.type === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'project-context-sep';
        menu.appendChild(sep);
        return;
      }

      const item = document.createElement('div');
      item.className = `project-context-item${a.danger ? ' danger' : ''}`;
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `${a.icon}<span>${a.label}</span>`;
      item.addEventListener('click', () => {
        menu.remove();
        a.action();
      });
      menu.appendChild(item);
    });

    /* Position near click */
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;
  }

  /* ─────────────────────────────────────────────────────────
     10. SET ACTIVE PROJECT
     Makes a project "active" — its context gets injected
     into every ALTAS conversation automatically
     ───────────────────────────────────────────────────────── */

  function setActiveProject(id) {
    state.activeProjectId = id;
    const project = state.projects.find(p => p.id === id);

    /* Update header indicator */
    _updateActiveProjectIndicator(project);

    /* Update sidebar list active state */
    renderProjectList();

    /* Emit event for app.js to inject context */
    document.dispatchEvent(new CustomEvent('altas:project-activated', {
      detail: { project },
    }));

    ALTAS.Toast.success(`Project "${project?.name}" is now active`);
  }

  function _updateActiveProjectIndicator(project) {
    if (!DOM.activeProjectIndicator) return;

    if (project) {
      DOM.activeProjectIndicator.classList.add('visible');
      if (DOM.activeProjectDot) {
        DOM.activeProjectDot.style.background = project.color;
      }
      if (DOM.activeProjectName) {
        DOM.activeProjectName.textContent = project.name;
      }
    } else {
      DOM.activeProjectIndicator.classList.remove('visible');
    }
  }

  /* Get active project context (injected into system prompt) */
  function getActiveProjectContext() {
    if (!state.activeProjectId) return '';
    const project = state.projects.find(p => p.id === state.activeProjectId);
    if (!project || !project.context) return '';
    return `\n\n## Active Project: ${project.name}\n${project.context}`;
  }

  /* ─────────────────────────────────────────────────────────
     11. WORKSPACE OPEN / CLOSE
     ───────────────────────────────────────────────────────── */

  function openWorkspace(id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;

    state.workspaceOpen = true;

    /* Populate workspace */
    _populateWorkspace(project);

    /* Show */
    if (DOM.workspace) {
      DOM.workspace.hidden = false;
      DOM.workspace.removeAttribute('hidden');
      requestAnimationFrame(() => DOM.workspace.classList.add('open'));
    }

    document.dispatchEvent(new CustomEvent('altas:workspace-opened', {
      detail: { project },
    }));
  }

  function closeWorkspace() {
    state.workspaceOpen = false;

    if (DOM.workspace) {
      DOM.workspace.classList.remove('open');
      DOM.workspace.addEventListener('transitionend', () => {
        if (!state.workspaceOpen) DOM.workspace.hidden = true;
      }, { once: true });
    }
  }

  function _populateWorkspace(project) {
    /* Header */
    if (DOM.workspaceName) DOM.workspaceName.textContent = project.name;
    if (DOM.workspaceColor) {
      DOM.workspaceColor.style.background = project.color;
      DOM.workspaceColor.style.boxShadow  = `0 0 10px ${project.color}80`;
    }

    /* Conversations pane */
    _renderWorkspaceConversations(project);

    /* Notes pane */
    if (DOM.notesEditor) DOM.notesEditor.value = project.notes || '';

    /* Context pane */
    if (DOM.contextEditor) DOM.contextEditor.value = project.context || '';

    /* Files pane */
    _renderWorkspaceFiles(project);

    /* Reset to conversations tab */
    switchWorkspaceTab('conversations');
  }

  /* ─────────────────────────────────────────────────────────
     12. WORKSPACE TAB SWITCHER
     ───────────────────────────────────────────────────────── */

  function switchWorkspaceTab(tab) {
    state.workspaceTab = tab;

    DOM.workspaceTabs?.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    DOM.workspacePanes?.forEach(p => {
      p.classList.toggle('active', p.dataset.pane === tab);
    });
  }

  /* ─────────────────────────────────────────────────────────
     13. CONVERSATIONS PANE
     ───────────────────────────────────────────────────────── */

  function _renderWorkspaceConversations(project) {
    if (!DOM.workspaceConvList) return;
    DOM.workspaceConvList.innerHTML = '';

    const convs = project.conversations || [];

    if (convs.length === 0) {
      DOM.workspaceConvList.innerHTML = `
        <div style="text-align:center; padding: var(--sp-8) var(--sp-4); color: var(--text-400); font-size: 13px;">
          No conversations in this project yet.<br>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-500); margin-top: 8px; display: block;">
            Assign conversations from the Chats tab.
          </span>
        </div>
      `;
      return;
    }

    convs.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'workspace-conv-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-label', conv.title || 'Untitled');

      item.innerHTML = `
        <div class="workspace-conv-dot" style="background: ${project.color}"></div>
        <span class="workspace-conv-title">${_escapeHtml(conv.title || 'Untitled conversation')}</span>
        <span class="workspace-conv-date">${_formatDate(conv.timestamp)}</span>
      `;

      item.addEventListener('click', () => {
        closeWorkspace();
        /* Switch to chats tab and load conversation */
        document.dispatchEvent(new CustomEvent('altas:load-conversation', {
          detail: { id: conv.id },
        }));
      });

      DOM.workspaceConvList.appendChild(item);
    });
  }

  /* Assign current conversation to active project */
  function assignConversationToProject(conversationId, projectId, convTitle) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    /* Avoid duplicates */
    if (project.conversations.some(c => c.id === conversationId)) return;

    project.conversations.push({
      id:        conversationId,
      title:     convTitle || 'Untitled',
      timestamp: Date.now(),
    });
    project.updatedAt = Date.now();
    saveProjects();
  }

  /* ─────────────────────────────────────────────────────────
     14. NOTES PANE
     ───────────────────────────────────────────────────────── */

  function _debouncedSaveNotes() {
    clearTimeout(state.notesSaveTimer);
    state.notesSaveTimer = setTimeout(() => {
      _saveNotes();
    }, 800);
  }

  function _saveNotes() {
    if (!state.workspaceOpen) return;
    const project = state.projects.find(p =>
      /* Find which project is open by checking workspace name */
      DOM.workspaceName?.textContent === p.name
    );
    if (!project) return;

    project.notes     = DOM.notesEditor?.value || '';
    project.updatedAt = Date.now();
    saveProjects();

    if (DOM.notesSaveIndicator) {
      DOM.notesSaveIndicator.textContent = 'Saved';
      DOM.notesSaveIndicator.classList.add('saved');
      setTimeout(() => {
        DOM.notesSaveIndicator.classList.remove('saved');
        DOM.notesSaveIndicator.textContent = '';
      }, 2000);
    }
  }

  /* ─────────────────────────────────────────────────────────
     15. FILES PANE
     ───────────────────────────────────────────────────────── */

  function attachFiles(fileObjs) {
    const project = _getOpenProject();
    if (!project) return;

    fileObjs.forEach(file => {
      /* Store file metadata (not binary — would need backend for actual storage) */
      const fileRecord = {
        id:       `file_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        name:     file.name,
        size:     file.size,
        type:     file.type,
        ext:      file.name.split('.').pop().toLowerCase(),
        addedAt:  Date.now(),
      };
      project.files = project.files || [];
      project.files.push(fileRecord);
    });

    project.updatedAt = Date.now();
    saveProjects();
    _renderWorkspaceFiles(project);
    ALTAS.Toast.success(`${fileObjs.length} file${fileObjs.length !== 1 ? 's' : ''} attached`);
  }

  function _renderWorkspaceFiles(project) {
    if (!DOM.fileList) return;
    DOM.fileList.innerHTML = '';

    const files = project.files || [];

    if (files.length === 0) return;

    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'workspace-file-item';
      item.setAttribute('role', 'listitem');

      const sizeStr = _formatFileSize(file.size);
      const date    = _formatDate(file.addedAt);

      item.innerHTML = `
        <div class="workspace-file-icon" data-ext="${_escapeHtml(file.ext)}">
          ${file.ext.toUpperCase().slice(0, 3)}
        </div>
        <div class="workspace-file-meta">
          <div class="workspace-file-name" title="${_escapeHtml(file.name)}">${_escapeHtml(file.name)}</div>
          <div class="workspace-file-info">${sizeStr} · ${date}</div>
        </div>
        <div class="workspace-file-actions">
          <button class="workspace-file-btn delete" aria-label="Remove file"
            data-file-id="${file.id}">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/>
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/>
            </svg>
          </button>
        </div>
      `;

      item.querySelector('.workspace-file-btn.delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(project, file.id);
      });

      DOM.fileList.appendChild(item);
    });
  }

  function removeFile(project, fileId) {
    project.files     = (project.files || []).filter(f => f.id !== fileId);
    project.updatedAt = Date.now();
    saveProjects();
    _renderWorkspaceFiles(project);
  }

  /* ─────────────────────────────────────────────────────────
     16. CONTEXT PANE
     ───────────────────────────────────────────────────────── */

  function _debouncedSaveContext() {
    clearTimeout(state.contextSaveTimer);
    state.contextSaveTimer = setTimeout(() => {
      _saveContext();
    }, 800);
  }

  function _saveContext() {
    const project = _getOpenProject();
    if (!project) return;
    project.context   = DOM.contextEditor?.value || '';
    project.updatedAt = Date.now();
    saveProjects();
  }

  /* ─────────────────────────────────────────────────────────
     17. NEW PROJECT MODAL
     ───────────────────────────────────────────────────────── */

  function openNewProjectModal() {
    if (!DOM.newProjectModal) return;

    /* Reset form */
    if (DOM.newProjectNameInput) DOM.newProjectNameInput.value = '';
    if (DOM.newProjectDescInput) DOM.newProjectDescInput.value = '';
    state.newProjectColor = PROJECT_COLORS[0].hex;
    state.newProjectIcon  = PROJECT_ICONS[0];
    _syncColorSelection();
    _syncIconSelection();

    DOM.newProjectModal.hidden = false;
    DOM.newProjectModal.removeAttribute('hidden');

    setTimeout(() => DOM.newProjectNameInput?.focus(), 100);
  }

  function closeNewProjectModal() {
    if (!DOM.newProjectModal) return;
    DOM.newProjectModal.hidden = true;
  }

  /* ─────────────────────────────────────────────────────────
     18. COLOUR + ICON PICKERS
     ───────────────────────────────────────────────────────── */

  function renderColorPicker() {
    if (!DOM.colorPicker) return;
    DOM.colorPicker.innerHTML = '';

    PROJECT_COLORS.forEach(({ hex, label }) => {
      const swatch = document.createElement('div');
      swatch.className = `project-color-swatch${hex === state.newProjectColor ? ' selected' : ''}`;
      swatch.style.background = hex;
      swatch.style.color      = hex;
      swatch.setAttribute('aria-label', label);
      swatch.setAttribute('title', label);
      swatch.dataset.color = hex;

      swatch.addEventListener('click', () => {
        state.newProjectColor = hex;
        _syncColorSelection();
      });

      DOM.colorPicker.appendChild(swatch);
    });
  }

  function renderIconPicker() {
    if (!DOM.iconPicker) return;
    DOM.iconPicker.innerHTML = '';

    PROJECT_ICONS.forEach(icon => {
      const option = document.createElement('div');
      option.className = `project-icon-option${icon === state.newProjectIcon ? ' selected' : ''}`;
      option.textContent = icon;
      option.setAttribute('aria-label', `Icon: ${icon}`);
      option.dataset.icon = icon;

      option.addEventListener('click', () => {
        state.newProjectIcon = icon;
        _syncIconSelection();
      });

      DOM.iconPicker.appendChild(option);
    });
  }

  function _syncColorSelection() {
    DOM.colorPicker?.querySelectorAll('.project-color-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === state.newProjectColor);
    });
  }

  function _syncIconSelection() {
    DOM.iconPicker?.querySelectorAll('.project-icon-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.icon === state.newProjectIcon);
    });
  }

  /* ─────────────────────────────────────────────────────────
     19. UTILS
     ───────────────────────────────────────────────────────── */

  function _getOpenProject() {
    return state.projects.find(p => DOM.workspaceName?.textContent === p.name) || null;
  }

  function _formatDate(ts) {
    if (!ts) return '';
    const d   = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function _formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────
     20. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    init,
    openWorkspace,
    closeWorkspace,
    createProject,
    deleteProject,
    setActiveProject,
    assignConversationToProject,
    getActiveProjectContext,
    switchSidebarTab,
    renderProjectList,
    get projects() { return state.projects; },
    get activeProjectId() { return state.activeProjectId; },
  };

})();

/* Auto-init */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASProjects.init);
} else {
  ALTASProjects.init();
}
