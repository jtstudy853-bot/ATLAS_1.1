/* ═══════════════════════════════════════════════════════════════
   ALTAS — CHAT.JS
   Message rendering · Markdown parser · Streaming cursor
   Tool call cards · Copy buttons · Conversation restore
   Depends on: ui.js · api.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASChat = (() => {

  /* ─────────────────────────────────────────────────────────
     1. STATE
     ───────────────────────────────────────────────────────── */

  const state = {
    messages:       [],        /* Full conversation history for API  */
    lastRole:       null,      /* Track consecutive same-sender msgs */
    activeStreamEl: null,      /* <p> element being streamed into    */
    activeWrapEl:   null,      /* .msg-wrap of active stream         */
    streamBuffer:   '',        /* Full streamed text accumulator      */
    toolCardEls:    {},        /* tool_use_id → DOM element map       */
  };

  /* ─────────────────────────────────────────────────────────
     2. DOM REFS
     ───────────────────────────────────────────────────────── */

  let chatInner = null;
  let chatArea  = null;

  function init() {
    chatInner = document.getElementById('chat-inner');
    chatArea  = document.getElementById('chat-area');
  }

  /* ─────────────────────────────────────────────────────────
     3. APPEND USER MESSAGE
     Renders the user bubble immediately on send
     ───────────────────────────────────────────────────────── */

  function appendUserMessage(text) {
    const isConsecutive = state.lastRole === 'user';
    state.lastRole = 'user';

    /* Add to messages array for API */
    state.messages.push({ role: 'user', content: text });

    const wrap = _buildMessageWrap('user', isConsecutive);
    const bubble = wrap.querySelector('.msg-bubble');

    /* Render user text as plain text (escaped) — no markdown in user msgs */
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = text;
    bubble.appendChild(content);

    _injectActions(wrap, 'user', text);
    _appendToChat(wrap);
  }

  /* ─────────────────────────────────────────────────────────
     4. TYPING INDICATOR
     Three-dot bounce shown while waiting for first token
     ───────────────────────────────────────────────────────── */

  function showTypingIndicator() {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-altas msg-typing-wrap';
    wrap.setAttribute('aria-label', 'ALTAS is thinking');
    wrap.setAttribute('role', 'status');

    const row = document.createElement('div');
    row.className = 'msg-row';

    /* Avatar */
    row.appendChild(_buildAvatar('altas', true));

    /* Typing bubble */
    const typingEl = document.createElement('div');
    typingEl.className = 'msg-typing';
    typingEl.innerHTML = `
      <div class="typing-dots" aria-hidden="true">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
      <span class="typing-label">Thinking…</span>
    `;

    row.appendChild(typingEl);
    wrap.appendChild(row);
    _appendToChat(wrap);
    return wrap;
  }

  /* ─────────────────────────────────────────────────────────
     5. STREAM CHUNK
     Called on every text delta from api.js onChunk callback.
     First call creates the ALTAS bubble; subsequent calls
     append text to the streaming content element.
     ───────────────────────────────────────────────────────── */

  function streamChunk(chunk, fullText) {
    state.streamBuffer = fullText;

    /* First chunk — build the ALTAS bubble */
    if (!state.activeStreamEl) {
      _initStreamBubble();
    }

    /* Append raw text — finaliseStream will parse markdown */
    state.activeStreamEl.textContent = fullText;

    /* Keep streaming cursor at end */
    _ensureStreamCursor();
  }

  function _initStreamBubble() {
    const isConsecutive = state.lastRole === 'assistant';
    state.lastRole = 'assistant';

    const wrap = _buildMessageWrap('altas', isConsecutive);
    state.activeWrapEl = wrap;

    const bubble = wrap.querySelector('.msg-bubble');

    /* Stream content paragraph */
    const content = document.createElement('div');
    content.className = 'msg-content msg-content--streaming';

    const p = document.createElement('p');
    p.className = 'stream-text';
    content.appendChild(p);

    bubble.appendChild(content);
    _appendToChat(wrap);

    state.activeStreamEl = p;
  }

  function _ensureStreamCursor() {
    if (!state.activeStreamEl) return;

    /* Remove old cursor */
    state.activeStreamEl.parentElement
      ?.querySelector('.stream-cursor')
      ?.remove();

    /* Append cursor span after the text node */
    const cursor = document.createElement('span');
    cursor.className = 'stream-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    state.activeStreamEl.after(cursor);
  }

  /* ─────────────────────────────────────────────────────────
     6. FINALISE STREAM
     Called by api.js onComplete. Replaces raw streamed text
     with fully parsed markdown. Removes cursor.
     ───────────────────────────────────────────────────────── */

  function finaliseStream(fullText) {
    /* Remove streaming cursor */
    state.activeWrapEl
      ?.querySelector('.stream-cursor')
      ?.remove();

    if (!state.activeWrapEl || !fullText) {
      _resetStreamState();
      return;
    }

    /* Replace streaming content with parsed markdown */
    const bubble  = state.activeWrapEl.querySelector('.msg-bubble');
    const content = state.activeWrapEl.querySelector('.msg-content');

    if (content) {
      content.classList.remove('msg-content--streaming');
      content.innerHTML = parseMarkdown(fullText);

      /* Attach copy buttons to code blocks */
      _attachCodeCopyButtons(content);

      /* Wrap tables for horizontal scroll */
      _wrapTables(content);

      /* Make external links open in new tab */
      _processLinks(content);
    }

    /* Add message actions bar */
    _injectActions(state.activeWrapEl, 'altas', fullText);

    /* Add token count badge to meta row */
    _appendTokenBadge(state.activeWrapEl, fullText);

    /* Push to messages array for API continuity */
    state.messages.push({ role: 'assistant', content: fullText });

    _resetStreamState();
  }

  function _resetStreamState() {
    state.activeStreamEl = null;
    state.activeWrapEl   = null;
    state.streamBuffer   = '';
  }

  /* ─────────────────────────────────────────────────────────
     7. TOOL CALL CARD
     Rendered when api.js fires onToolCall.
     Shows which tool is being called + status indicator.
     ───────────────────────────────────────────────────────── */

  function renderToolCallCard({ id, name, icon, label, detail, phase }) {
    /* If start phase — create the card */
    if (phase === 'start') {
      const card = document.createElement('div');
      card.className = 'tool-call-card tool-call-card--running';
      card.setAttribute('aria-label', `ALTAS using tool: ${label}`);
      card.dataset.toolId = id;
      card.dataset.tool   = name;  /* Drives per-tool colour in tool-cards.css */

      card.innerHTML = `
        <div class="tool-call-icon" aria-hidden="true">${icon}</div>
        <div class="tool-call-body">
          <div class="tool-call-label">${_escapeHtml(label)}</div>
          <div class="tool-call-detail" id="tool-detail-${id}">
            ${detail ? _escapeHtml(detail) : 'Working…'}
          </div>
        </div>
        <div class="tool-call-status" aria-label="Running">
          <div class="tool-call-spinner"></div>
        </div>
      `;

      /* Insert before the active stream bubble, or append */
      const target = state.activeWrapEl || chatInner;
      if (state.activeWrapEl) {
        chatInner.insertBefore(card, state.activeWrapEl);
      } else {
        chatInner.appendChild(card);
      }

      state.toolCardEls[id] = card;
      return card;
    }

    /* If complete phase — update the card */
    if (phase === 'complete' && state.toolCardEls[id]) {
      const card = state.toolCardEls[id];
      card.classList.remove('tool-call-card--running');
      card.classList.add('tool-call-card--done');

      const statusEl = card.querySelector('.tool-call-status');
      const detailEl = card.querySelector(`#tool-detail-${id}`);

      if (statusEl) {
        statusEl.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 6l3 3 5-5"/>
          </svg>
        `;
        statusEl.setAttribute('aria-label', 'Complete');
      }

      if (detailEl && detail) {
        detailEl.textContent = detail;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     8. ERROR MESSAGE
     ───────────────────────────────────────────────────────── */

  function appendErrorMessage(errorText) {
    const isConsecutive = state.lastRole === 'assistant';
    state.lastRole = 'assistant';

    const wrap = _buildMessageWrap('altas', isConsecutive);
    wrap.classList.add('msg-error');

    const bubble = wrap.querySelector('.msg-bubble');

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = `
      <div class="msg-error-banner" role="alert">
        <span class="msg-error-icon" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6.5" cy="6.5" r="5.5"/>
            <line x1="6.5" y1="4" x2="6.5" y2="7"/>
            <circle cx="6.5" cy="9" r="0.6" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <span>${_escapeHtml(errorText)}</span>
      </div>
      <p class="muted" style="font-size:13px; margin-top: 8px;">
        Check your connection or backend URL in Settings.
      </p>
    `;

    bubble.appendChild(content);
    _appendToChat(wrap);
  }

  /* ─────────────────────────────────────────────────────────
     9. MARKDOWN PARSER
     Production-grade regex-based parser. Handles:
     headings · bold · italic · inline code · code blocks
     blockquotes · ordered + unordered lists · tables
     horizontal rules · links · line breaks
     ───────────────────────────────────────────────────────── */

  function parseMarkdown(raw) {
    if (!raw) return '';

    let md = raw;

    /* ── 1. Code blocks (fenced ```) — extract first to protect from other rules ── */
    const codeBlocks = [];
    md = md.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || '', code: code.trimEnd() });
      return `\x00CODE${idx}\x00`;
    });

    /* ── 2. Blockquotes ── */
    md = md.replace(/^(&gt;|>) (.+)$/gm, (_, _q, text) => {
      return `<blockquote><p>${text}</p></blockquote>`;
    });

    /* ── 3. Headings ── */
    md = md.replace(/^#{4} (.+)$/gm, '<h4>$1</h4>');
    md = md.replace(/^#{3} (.+)$/gm, '<h3>$1</h3>');
    md = md.replace(/^#{2} (.+)$/gm, '<h2>$1</h2>');
    md = md.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    /* ── 4. Horizontal rules ── */
    md = md.replace(/^---+$/gm, '<hr>');
    md = md.replace(/^\*\*\*+$/gm, '<hr>');

    /* ── 5. Tables ── */
    md = md.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
      const rows = block.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return block;

      const isAlignRow = (r) => /^\|[\s\-:| ]+\|$/.test(r.trim());
      if (!isAlignRow(rows[1])) return block;

      const parseRow = (r) =>
        r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

      const headers = parseRow(rows[0]);
      const dataRows = rows.slice(2);

      const thead = `<thead><tr>${
        headers.map(h => `<th>${_inlineMarkdown(h)}</th>`).join('')
      }</tr></thead>`;

      const tbody = `<tbody>${
        dataRows.map(r =>
          `<tr>${parseRow(r).map(c => `<td>${_inlineMarkdown(c)}</td>`).join('')}</tr>`
        ).join('')
      }</tbody>`;

      return `\x00TABLE<table>${thead}${tbody}</table>\x00`;
    });

    /* ── 6. Unordered lists ── */
    md = md.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n')
        .filter(l => l.trim())
        .map(l => `<li>${_inlineMarkdown(l.replace(/^[ \t]*[-*+] /, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    });

    /* ── 7. Ordered lists ── */
    md = md.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n')
        .filter(l => l.trim())
        .map(l => `<li>${_inlineMarkdown(l.replace(/^\d+\. /, ''))}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    });

    /* ── 8. Double newlines → paragraph breaks ── */
    md = md.split(/\n\n+/).map(block => {
      block = block.trim();
      if (!block) return '';

      /* Don't wrap blocks that are already HTML elements */
      if (/^\x00(CODE|TABLE)/.test(block)) return block;
      if (/^<(h[1-4]|ul|ol|blockquote|hr|table)/.test(block)) return block;

      /* Apply inline markdown and wrap in <p> */
      return `<p>${_inlineMarkdown(block.replace(/\n/g, '<br>'))}</p>`;
    }).join('');

    /* ── 9. Single newlines in remaining text → <br> ── */
    md = md.replace(/([^>])\n([^<])/g, '$1<br>$2');

    /* ── 10. Restore table blocks ── */
    md = md.replace(/\x00TABLE(<table>[\s\S]*?<\/table>)\x00/g, '$1');

    /* ── 11. Restore code blocks with syntax-highlighted HTML ── */
    md = md.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
      const { lang, code } = codeBlocks[parseInt(idx)];
      const highlighted   = _highlightCode(code, lang);
      const langLabel     = lang || 'text';

      return `
        <div class="code-block" data-lang="${_escapeAttr(langLabel)}">
          <div class="code-block-header">
            <div class="code-block-header-left">
              <div class="code-block-dots" aria-hidden="true">
                <div class="code-block-dot"></div>
                <div class="code-block-dot"></div>
                <div class="code-block-dot"></div>
              </div>
              <span class="code-lang-label">${_escapeHtml(langLabel)}</span>
            </div>
            <div class="code-block-actions">
              <button class="btn-code-copy" data-code="${_escapeAttr(code)}" aria-label="Copy code">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="4" width="6" height="6" rx="1"/>
                  <path d="M1 7V1h6v3"/>
                </svg>
                Copy
              </button>
            </div>
          </div>
          <pre><code class="code-lang-${_escapeAttr(langLabel)}">${highlighted}</code></pre>
        </div>
      `;
    });

    return md;
  }

  /* ── Inline markdown (bold, italic, code, links, strikethrough) ── */
  function _inlineMarkdown(text) {
    if (!text) return '';

    /* Escape HTML first */
    let t = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    /* Inline code — protect from other rules */
    const inlineCodes = [];
    t = t.replace(/`([^`]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(code);
      return `\x00IC${idx}\x00`;
    });

    /* Bold + italic: ***text*** */
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    /* Bold: **text** or __text__ */
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');

    /* Italic: *text* or _text_ */
    t = t.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, '<em>$1</em>');
    t = t.replace(/_(?!_)(.+?)(?<!_)_/g, '<em>$1</em>');

    /* Strikethrough: ~~text~~ */
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');

    /* Links: [text](url) */
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
      const safeUrl = url.startsWith('http') || url.startsWith('/') ? url : '#';
      return `<a href="${_escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });

    /* Restore inline codes */
    t = t.replace(/\x00IC(\d+)\x00/g, (_, idx) => {
      return `<code>${_escapeHtml(inlineCodes[parseInt(idx)])}</code>`;
    });

    return t;
  }

  /* ─────────────────────────────────────────────────────────
     10. SYNTAX HIGHLIGHTER
     Lightweight token-based highlighter for common languages.
     Applies .tok-* classes matched in chat.css.
     ───────────────────────────────────────────────────────── */

  function _highlightCode(code, lang) {
    /* Escape HTML entities first */
    let escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (!lang || lang === 'text' || lang === 'plaintext') return escaped;

    const l = lang.toLowerCase();

    /* Python */
    if (l === 'python' || l === 'py') {
      return escaped
        .replace(/(#.*)$/gm,                              '<span class="tok-comment">$1</span>')
        .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g,      '<span class="tok-string">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,'<span class="tok-string">$1</span>')
        .replace(/\b(def|class|return|import|from|as|if|elif|else|for|while|in|not|and|or|is|None|True|False|try|except|finally|with|yield|lambda|pass|break|continue|raise|del|global|nonlocal|assert|async|await)\b/g,
                 '<span class="tok-keyword">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g,                      '<span class="tok-number">$1</span>')
        .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g,             '<span class="tok-type">$1</span>')
        .replace(/\b([a-z_][a-z0-9_]*)\s*(?=\()/g,        '<span class="tok-function">$1</span>');
    }

    /* JavaScript / TypeScript */
    if (l === 'javascript' || l === 'js' || l === 'typescript' || l === 'ts') {
      return escaped
        .replace(/(\/\/.*$)/gm,                            '<span class="tok-comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g,                    '<span class="tok-comment">$1</span>')
        .replace(/(`(?:[^`\\]|\\.)*`)/g,                   '<span class="tok-string">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,'<span class="tok-string">$1</span>')
        .replace(/\b(const|let|var|function|class|return|import|export|from|if|else|for|while|do|switch|case|break|continue|new|this|typeof|instanceof|void|delete|in|of|try|catch|finally|throw|async|await|default|extends|super|static|get|set|null|undefined|true|false|yield)\b/g,
                 '<span class="tok-keyword">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g,                       '<span class="tok-number">$1</span>')
        .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g,              '<span class="tok-type">$1</span>')
        .replace(/\b([a-z_$][a-z0-9_$]*)\s*(?=\()/g,       '<span class="tok-function">$1</span>')
        .replace(/([+\-*/%=<>!&|^~?:]+)/g,                 '<span class="tok-operator">$1</span>');
    }

    /* Bash / Shell */
    if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh') {
      return escaped
        .replace(/(#.*)$/gm,                               '<span class="tok-comment">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,'<span class="tok-string">$1</span>')
        .replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|export|source|cd|ls|mkdir|rm|cp|mv|grep|sed|awk|curl|wget|git|npm|pip|python|node)\b/g,
                 '<span class="tok-keyword">$1</span>')
        .replace(/(\$[a-zA-Z_][a-zA-Z0-9_]*|\$\{[^}]+\}|\$\([^)]+\))/g,
                 '<span class="tok-constant">$1</span>')
        .replace(/\b(\d+)\b/g,                             '<span class="tok-number">$1</span>');
    }

    /* JSON */
    if (l === 'json') {
      return escaped
        .replace(/("(?:[^"\\]|\\.)*")\s*:/g,   '<span class="tok-keyword">$1</span>:')
        .replace(/:\s*("(?:[^"\\]|\\.)*")/g,   ': <span class="tok-string">$1</span>')
        .replace(/\b(true|false|null)\b/g,      '<span class="tok-constant">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g,           '<span class="tok-number">$1</span>');
    }

    /* CSS */
    if (l === 'css' || l === 'scss' || l === 'less') {
      return escaped
        .replace(/(\/\*[\s\S]*?\*\/)/g,         '<span class="tok-comment">$1</span>')
        .replace(/([.#][a-zA-Z][a-zA-Z0-9_-]*)/g,'<span class="tok-function">$1</span>')
        .replace(/(:[a-zA-Z-]+)/g,               '<span class="tok-keyword">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,'<span class="tok-string">$1</span>')
        .replace(/(#[0-9a-fA-F]{3,8})\b/g,      '<span class="tok-constant">$1</span>')
        .replace(/\b(\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms)?)\b/g,'<span class="tok-number">$1</span>');
    }

    /* HTML / XML */
    if (l === 'html' || l === 'xml' || l === 'svg') {
      return escaped
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g,              '<span class="tok-comment">$1</span>')
        .replace(/(&lt;\/?)([\w:-]+)/g,                   '$1<span class="tok-keyword">$2</span>')
        .replace(/ ([\w:-]+)=("[^"]*"|'[^']*')/g,
                 ' <span class="tok-function">$1</span>=<span class="tok-string">$2</span>');
    }

    /* SQL */
    if (l === 'sql') {
      return escaped
        .replace(/(--.*$)/gm,                              '<span class="tok-comment">$1</span>')
        .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|UNIQUE|AND|OR|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END)\b/gi,
                 '<span class="tok-keyword">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g,                   '<span class="tok-string">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g,                       '<span class="tok-number">$1</span>');
    }

    /* Fallback — return escaped with no highlighting */
    return escaped;
  }

  /* ─────────────────────────────────────────────────────────
     11. MESSAGE BUBBLE BUILDER
     Constructs the full .msg-wrap DOM structure
     ───────────────────────────────────────────────────────── */

  function _buildMessageWrap(role, isConsecutive) {
    const wrap = document.createElement('div');
    wrap.className = [
      'msg-wrap',
      role === 'user' ? 'msg-user' : 'msg-altas',
      isConsecutive ? 'consecutive' : '',
    ].filter(Boolean).join(' ');

    wrap.setAttribute('role', 'article');
    wrap.setAttribute('aria-label', role === 'user' ? 'Your message' : 'ALTAS response');

    const row = document.createElement('div');
    row.className = 'msg-row';

    /* Avatar */
    row.appendChild(_buildAvatar(role, false));

    /* Bubble */
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    /* Meta row (sender + timestamp) — hidden for consecutive */
    if (!isConsecutive) {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';

      const sender = document.createElement('span');
      sender.className = 'msg-sender';
      sender.textContent = role === 'user' ? 'You' : 'ALTAS';

      const timestamp = document.createElement('span');
      timestamp.className = 'msg-timestamp';
      timestamp.textContent = _formatTime(new Date());

      meta.appendChild(sender);
      meta.appendChild(timestamp);
      bubble.appendChild(meta);
    }

    row.appendChild(bubble);
    wrap.appendChild(row);
    return wrap;
  }

  /* ─────────────────────────────────────────────────────────
     12. AVATAR BUILDER
     ───────────────────────────────────────────────────────── */

  function _buildAvatar(role, isTyping) {
    const avatar = document.createElement('div');
    avatar.className = `msg-avatar msg-avatar--${role === 'user' ? 'user' : 'altas'}`;
    avatar.setAttribute('aria-hidden', 'true');

    if (role === 'user') {
      avatar.textContent = 'U';
    } else {
      /* ALTAS hex SVG avatar */
      avatar.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="7.5,1 13,4.25 13,10.75 7.5,14 2,10.75 2,4.25"
            fill="none" stroke="rgba(123,108,255,0.5)" stroke-width="0.6"/>
          <circle cx="7.5" cy="7.5" r="2.5" fill="#7B6CFF" opacity="0.9"/>
          <circle cx="7.5" cy="7.5" r="1.4" fill="#C4BFFF"/>
        </svg>
      `;
      if (isTyping) avatar.classList.add('streaming');
    }

    return avatar;
  }

  /* ─────────────────────────────────────────────────────────
     13. MESSAGE ACTIONS BAR
     Copy, regenerate — injected after bubble
     ───────────────────────────────────────────────────────── */

  function _injectActions(wrap, role, text) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.setAttribute('aria-label', 'Message actions');

    /* Copy button */
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn btn-copy';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="6" height="6" rx="1"/>
        <path d="M1 7V1h6v3"/>
      </svg>
      Copy
    `;
    copyBtn.addEventListener('click', () => {
      ALTAS.copyToClipboard(text, copyBtn);
    });
    actions.appendChild(copyBtn);

    /* ALTAS-only: thumbs up/down */
    if (role === 'altas') {
      const thumbUp = _buildActionBtn('👍', 'Good response', () => {
        thumbUp.classList.add('active');
        thumbDown.classList.remove('active');
      });
      const thumbDown = _buildActionBtn('👎', 'Bad response', () => {
        thumbDown.classList.add('active');
        thumbUp.classList.remove('active');
      });

      actions.appendChild(thumbUp);
      actions.appendChild(thumbDown);
    }

    wrap.appendChild(actions);
  }

  function _buildActionBtn(emoji, label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'msg-action-btn';
    btn.setAttribute('aria-label', label);
    btn.textContent = emoji;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ─────────────────────────────────────────────────────────
     14. TOKEN BADGE
     Appended to ALTAS message meta after stream completes
     ───────────────────────────────────────────────────────── */

  function _appendTokenBadge(wrap, text) {
    const meta = wrap.querySelector('.msg-meta');
    if (!meta) return;

    const approxTokens = Math.ceil(text.length / 4);
    const badge = document.createElement('span');
    badge.className = 'msg-token-count';
    badge.textContent = `~${approxTokens} tokens`;
    meta.appendChild(badge);
  }

  /* ─────────────────────────────────────────────────────────
     15. CODE BLOCK COPY BUTTONS
     Wired after markdown is parsed into DOM
     ───────────────────────────────────────────────────────── */

  function _attachCodeCopyButtons(contentEl) {
    contentEl.querySelectorAll('.btn-code-copy').forEach(btn => {
      /* Decode the data-code attribute */
      const code = btn.dataset.code || '';

      btn.addEventListener('click', async () => {
        await ALTAS.copyToClipboard(code, btn);
      });
    });
  }

  /* ─────────────────────────────────────────────────────────
     16. TABLE WRAP + LINK PROCESSING
     ───────────────────────────────────────────────────────── */

  function _wrapTables(contentEl) {
    contentEl.querySelectorAll('table').forEach(table => {
      if (table.parentElement?.classList.contains('table-wrap')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }

  function _processLinks(contentEl) {
    contentEl.querySelectorAll('a').forEach(a => {
      if (a.href.startsWith('http')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     17. APPEND TO CHAT
     Adds element to chatInner and auto-scrolls if at bottom
     ───────────────────────────────────────────────────────── */

  function _appendToChat(el) {
    if (!chatInner) init();
    chatInner.appendChild(el);

    /* Auto-scroll if user was already at bottom */
    if (ALTAS.Scroll.isAtBottom(chatArea)) {
      ALTAS.Scroll.scrollToBottom(chatArea, false);
    }
  }

  /* ─────────────────────────────────────────────────────────
     18. CONVERSATION RESET + RESTORE
     ───────────────────────────────────────────────────────── */

  function reset() {
    state.messages   = [];
    state.lastRole   = null;
    state.toolCardEls = {};
    _resetStreamState();
    _clearChatDOM();
  }

  function clear() {
    reset();
    _showClearedNotice();
  }

  function _clearChatDOM() {
    if (!chatInner) return;

    /* Remove all message elements but keep the welcome screen */
    const welcome = document.getElementById('welcome');
    chatInner.innerHTML = '';
    if (welcome) chatInner.appendChild(welcome);
  }

  function _showClearedNotice() {
    const notice = document.createElement('div');
    notice.className = 'chat-cleared-notice';
    notice.setAttribute('aria-live', 'polite');
    notice.innerHTML = `
      <div class="chat-cleared-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h10M5 3V2h4v1M11 3l-.8 9H3.8L3 3"/>
        </svg>
      </div>
      <span>Conversation cleared</span>
    `;

    chatInner.appendChild(notice);

    /* Fade it out after 3s */
    setTimeout(() => {
      notice.style.animation = 'fade-out 0.4s ease forwards';
      notice.addEventListener('animationend', () => notice.remove(), { once: true });
    }, 3000);
  }

  /* Restore a saved conversation from localStorage */
  function restoreMessages(messages) {
    reset();

    messages.forEach(msg => {
      if (msg.role === 'user') {
        appendUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        /* Render as a completed ALTAS message */
        _renderCompletedAltasMessage(msg.content);
      }
    });
  }

  function _renderCompletedAltasMessage(text) {
    const isConsecutive = state.lastRole === 'assistant';
    state.lastRole = 'assistant';

    state.messages.push({ role: 'assistant', content: text });

    const wrap = _buildMessageWrap('altas', isConsecutive);
    const bubble = wrap.querySelector('.msg-bubble');

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = parseMarkdown(text);

    bubble.appendChild(content);

    _attachCodeCopyButtons(content);
    _wrapTables(content);
    _processLinks(content);
    _injectActions(wrap, 'altas', text);
    _appendTokenBadge(wrap, text);
    _appendToChat(wrap);
  }

  /* ─────────────────────────────────────────────────────────
     19. DATE DIVIDER
     Injected between messages from different days
     ───────────────────────────────────────────────────────── */

  function _maybeInjectDateDivider() {
    const now = new Date();
    const lastDivider = chatInner?.querySelector('.date-divider:last-of-type');

    if (lastDivider) {
      const dividerDate = lastDivider.dataset.date;
      if (dividerDate === now.toDateString()) return;
    }

    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.dataset.date = now.toDateString();
    divider.setAttribute('aria-hidden', 'true');

    divider.innerHTML = `
      <div class="date-divider-line"></div>
      <span class="date-divider-label">${_formatDate(now)}</span>
      <div class="date-divider-line"></div>
    `;

    chatInner.appendChild(divider);
  }

  /* ─────────────────────────────────────────────────────────
     20. UTILS
     ───────────────────────────────────────────────────────── */

  function _formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function _formatDate(date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────────────────
     21. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    init,
    appendUserMessage,
    showTypingIndicator,
    streamChunk,
    finaliseStream,
    appendErrorMessage,
    renderToolCallCard,
    restoreMessages,
    reset,
    clear,
    parseMarkdown,
    getMessages: () => [...state.messages],
  };

})();

/* ─────────────────────────────────────────────────────────────
   TOOL CARD STYLES — now in css/tool-cards.css
   Stub removed: styles loaded via <link> in index.html
   ───────────────────────────────────────────────────────────── */

/* Auto-init when DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ALTASChat.init);
} else {
  ALTASChat.init();
}
