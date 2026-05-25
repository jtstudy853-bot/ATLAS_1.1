/* ═══════════════════════════════════════════════════════════════
   ALTAS — API.JS
   Anthropic streaming client · Tool use handler · Retry logic
   Abort controller · Error normalisation · Mode → temperature
   Depends on: ui.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const ALTASAPI = (() => {

  /* ─────────────────────────────────────────────────────────
     1. CONFIG
     ───────────────────────────────────────────────────────── */

  const CONFIG = {
    /* Fallback — overridden by Settings panel */
    backendUrl:   '',
    model:        'claude-haiku-4-5-20251001',
    maxRetries:   2,
    retryDelayMs: 800,
  };

  /* Mode → temperature mapping */
  const MODE_TEMP = {
    precise:  0.2,
    balanced: 0.7,
    creative: 1.0,
  };

  /* Active AbortController — one per request */
  let activeController = null;

  /* ─────────────────────────────────────────────────────────
     2. TOOL DEFINITIONS
     All 10 tools from Atlas Tool Suite — registered here so
     the backend can pass them to Claude. Backend must support
     tool_use responses and route tool calls appropriately.
     ───────────────────────────────────────────────────────── */

  const TOOLS = [

    {
      name: 'run_code',
      description: 'Executes code in a sandboxed environment and returns stdout, stderr, and exit code. Use when the user wants to test logic, run scripts, or validate outputs.',
      input_schema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            enum: ['python', 'javascript', 'bash', 'typescript'],
            description: 'The programming language to run the code in.',
          },
          code: {
            type: 'string',
            description: 'The code to execute.',
          },
          timeout_seconds: {
            type: 'integer',
            description: 'Max execution time in seconds. Defaults to 10.',
            default: 10,
          },
        },
        required: ['language', 'code'],
      },
    },

    {
      name: 'web_search',
      description: 'Searches the web for current information, documentation, news, or answers. Use when knowledge may be outdated or the user needs live data.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query.',
          },
          num_results: {
            type: 'integer',
            description: 'Number of results to return. Defaults to 5.',
            default: 5,
          },
        },
        required: ['query'],
      },
    },

    {
      name: 'read_file',
      description: 'Reads the contents of a file at a given path. Use to inspect source code, configs, logs, or any text-based file.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative file path to read.',
          },
          start_line: {
            type: 'integer',
            description: 'Optional: Start reading from this line number (1-indexed).',
          },
          end_line: {
            type: 'integer',
            description: 'Optional: Stop reading at this line number (inclusive).',
          },
        },
        required: ['path'],
      },
    },

    {
      name: 'write_file',
      description: 'Writes content to a file at the specified path, creating or overwriting it. Use for saving generated code, configs, notes, or any output.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to write to.',
          },
          content: {
            type: 'string',
            description: 'The content to write into the file.',
          },
          mode: {
            type: 'string',
            enum: ['overwrite', 'append'],
            description: 'Whether to overwrite or append. Defaults to overwrite.',
            default: 'overwrite',
          },
        },
        required: ['path', 'content'],
      },
    },

    {
      name: 'memory_store',
      description: 'Saves a key-value memory entry so ALTAS can recall it in future sessions. Use for storing user preferences, project context, recurring tasks, or any fact worth remembering.',
      input_schema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: "A unique identifier for this memory (e.g. 'preferred_language', 'current_project').",
          },
          value: {
            type: 'string',
            description: 'The value or content to store.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: "Optional tags to categorize this memory (e.g. ['project', 'preference']).",
          },
        },
        required: ['key', 'value'],
      },
    },

    {
      name: 'memory_recall',
      description: 'Retrieves previously stored memory entries by key or tag. Use at the start of sessions or when context from past conversations is needed.',
      input_schema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Exact key to look up.',
          },
          tag: {
            type: 'string',
            description: 'Return all memories matching this tag.',
          },
          query: {
            type: 'string',
            description: 'Fuzzy/semantic search across all stored memories.',
          },
        },
      },
    },

    {
      name: 'github_action',
      description: 'Performs actions on GitHub: read/create issues, open PRs, fetch commit history, list repos, or read file contents from a repo.',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_repos', 'get_issue', 'create_issue', 'list_prs', 'get_file', 'get_commits'],
            description: 'The GitHub action to perform.',
          },
          repo: {
            type: 'string',
            description: "Repository in owner/repo format (e.g. 'yourname/atlas').",
          },
          params: {
            type: 'object',
            description: 'Action-specific parameters (e.g. issue number, file path, branch name).',
            additionalProperties: true,
          },
        },
        required: ['action'],
      },
    },

    {
      name: 'send_notification',
      description: 'Sends a notification or reminder to the user via their preferred channel. Use for reminders, task completions, or alerts ALTAS detects as important.',
      input_schema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: ['email', 'push', 'webhook'],
            description: 'Delivery channel for the notification.',
          },
          message: {
            type: 'string',
            description: 'The notification body.',
          },
          title: {
            type: 'string',
            description: 'Short title or subject line.',
          },
          schedule_at: {
            type: 'string',
            format: 'date-time',
            description: 'Optional ISO 8601 datetime to schedule the notification for later.',
          },
        },
        required: ['channel', 'message', 'title'],
      },
    },

    {
      name: 'summarize_document',
      description: 'Fetches and summarizes a document from a URL or raw text. Useful for digesting articles, docs, PDFs, or lengthy content quickly.',
      input_schema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'A URL or raw text string to summarize.',
          },
          style: {
            type: 'string',
            enum: ['brief', 'detailed', 'bullet_points', 'eli5'],
            description: 'Summary style. Defaults to brief.',
            default: 'brief',
          },
          focus: {
            type: 'string',
            description: "Optional: What aspect to focus on (e.g. 'security implications', 'key APIs').",
          },
        },
        required: ['source'],
      },
    },

    {
      name: 'calendar_action',
      description: "Reads upcoming events or creates/deletes ones on the user's calendar. Use for scheduling, reminders, or answering 'what's on my calendar today'. Triggered by /add event command.",
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_events', 'create_event', 'delete_event'],
            description: 'Calendar action to perform.',
          },
          date_range: {
            type: 'object',
            properties: {
              start: { type: 'string', format: 'date-time' },
              end:   { type: 'string', format: 'date-time' },
            },
            description: 'Date range for listing events.',
          },
          event: {
            type: 'object',
            description: 'Event details for create_event.',
            properties: {
              title:       { type: 'string' },
              start:       { type: 'string', format: 'date-time' },
              end:         { type: 'string', format: 'date-time' },
              description: { type: 'string' },
              location:    { type: 'string' },
            },
          },
        },
        required: ['action'],
      },
    },

  ];

  /* ─────────────────────────────────────────────────────────
     3. SYSTEM PROMPT
     ALTAS personality + tool awareness + slash command hints
     ───────────────────────────────────────────────────────── */

  function buildSystemPrompt(customInstructions = '') {
    const base = `You are ALTAS — Adaptive, Logical, Tactical, Autonomous, Sentinel.
You are a personal AI second brain built to help your user think deeper, work faster, and learn better.

## Personality
- Precise and direct. No fluff, no filler, no hollow affirmations.
- Intellectually curious. You engage with ideas genuinely.
- Adaptive. You match the user's register — technical when needed, conversational when not.
- Proactive. If you notice something important the user hasn't asked about, surface it.

## Capabilities
You have access to tools: run_code, web_search, read_file, write_file, memory_store, memory_recall, github_action, send_notification, summarize_document, calendar_action.
Use them autonomously when they would produce a better answer. Do not ask for permission to use a tool — just use it.

## Slash Commands (user may type these)
- /add event [details] → call calendar_action with action: create_event
- /add file [path] → call read_file with the given path
- /search [query] → call web_search with the query
- /run [language] [code] → call run_code
- /remember [key] [value] → call memory_store
- /recall [key or tag] → call memory_recall
- /summarize [url or text] → call summarize_document
- /notify [message] → call send_notification

## Response format
- Use markdown. Structure long answers with headers and lists.
- For code: always use fenced code blocks with language specified.
- For tool results: present them cleanly, don't dump raw JSON.
- Be concise. If the answer is short, keep it short.

## Memory
You remember context across this session. Use memory_recall at the start of important tasks to check if relevant past context exists.

Today's date: ${new Date().toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;

    return customInstructions
      ? `${base}\n\n## Custom instructions from user\n${customInstructions}`
      : base;
  }

  /* ─────────────────────────────────────────────────────────
     4. BACKEND URL RESOLUTION
     Tries Settings → localStorage → empty string
     ───────────────────────────────────────────────────────── */

  function getBackendUrl() {
    if (CONFIG.backendUrl) return CONFIG.backendUrl.replace(/\/$/, '');

    try {
      const s = JSON.parse(localStorage.getItem('altas_settings') || '{}');
      if (s.backendUrl) {
        CONFIG.backendUrl = s.backendUrl;
        return CONFIG.backendUrl.replace(/\/$/, '');
      }
    } catch { /* ignore */ }

    return '';
  }

  function setBackendUrl(url) {
    CONFIG.backendUrl = url || '';
  }

  /* ─────────────────────────────────────────────────────────
     5. PING — health check
     ───────────────────────────────────────────────────────── */

  async function ping() {
    const base = getBackendUrl();
    if (!base) return false;

    try {
      const res = await fetch(`${base}/ping`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ─────────────────────────────────────────────────────────
     6. ABORT
     Cancel active stream
     ───────────────────────────────────────────────────────── */

  function abort() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  }

  /* ─────────────────────────────────────────────────────────
     7. SLASH COMMAND PARSER
     Intercepts /commands before sending to API.
     Returns { handled, prompt } — if handled the command was
     pre-processed and prompt is the cleaned version.
     ───────────────────────────────────────────────────────── */

  function parseSlashCommand(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) return { handled: false, prompt: rawInput };

    const [cmd, ...rest] = trimmed.slice(1).split(' ');
    const args = rest.join(' ').trim();

    const COMMANDS = {
      'add':        handleAddCommand,
      'search':     (a) => `web_search hint: ${a}`,
      'run':        (a) => `run_code hint: ${a}`,
      'remember':   (a) => `memory_store hint: ${a}`,
      'recall':     (a) => `memory_recall hint: ${a}`,
      'summarize':  (a) => `summarize_document hint: ${a}`,
      'notify':     (a) => `send_notification hint: ${a}`,
    };

    const handler = COMMANDS[cmd.toLowerCase()];
    if (!handler) return { handled: false, prompt: rawInput };

    const result = handler(args);
    return { handled: true, prompt: result };
  }

  function handleAddCommand(args) {
    const lower = args.toLowerCase();
    if (lower.startsWith('event') || lower.startsWith('ev')) {
      const details = args.replace(/^event\s*/i, '').replace(/^ev\s*/i, '');
      return `Please create a calendar event with these details: ${details || '[ask user for details]'}. Use the calendar_action tool with action: create_event.`;
    }
    if (lower.startsWith('file') || lower.startsWith('fi')) {
      const path = args.replace(/^file\s*/i, '').replace(/^fi\s*/i, '');
      return `Please read the file at path: ${path || '[ask user for path]'}. Use the read_file tool.`;
    }
    return args;
  }

  /* ─────────────────────────────────────────────────────────
     8. TOOL RESULT RENDERER
     Formats tool use + tool result blocks into readable UI
     Called by ALTASChat when a tool_use block is received
     ───────────────────────────────────────────────────────── */

  function formatToolCall(toolName, toolInput) {
    const icons = {
      run_code:           '⟩_',
      web_search:         '⊹',
      read_file:          '⬡',
      write_file:         '⬡',
      memory_store:       '◈',
      memory_recall:      '◈',
      github_action:      '⌥',
      send_notification:  '◎',
      summarize_document: '⊞',
      calendar_action:    '⊡',
    };

    const labels = {
      run_code:           'Running code',
      web_search:         'Searching web',
      read_file:          'Reading file',
      write_file:         'Writing file',
      memory_store:       'Saving memory',
      memory_recall:      'Recalling memory',
      github_action:      'GitHub action',
      send_notification:  'Sending notification',
      summarize_document: 'Summarising document',
      calendar_action:    'Calendar action',
    };

    const icon  = icons[toolName]  || '⬡';
    const label = labels[toolName] || toolName;

    let detail = '';
    if (toolName === 'run_code')          detail = toolInput.language ? `${toolInput.language}` : '';
    if (toolName === 'web_search')        detail = toolInput.query ? `"${toolInput.query}"` : '';
    if (toolName === 'read_file')         detail = toolInput.path || '';
    if (toolName === 'write_file')        detail = toolInput.path || '';
    if (toolName === 'memory_store')      detail = toolInput.key || '';
    if (toolName === 'memory_recall')     detail = toolInput.key || toolInput.tag || toolInput.query || '';
    if (toolName === 'github_action')     detail = `${toolInput.action}${toolInput.repo ? ` · ${toolInput.repo}` : ''}`;
    if (toolName === 'send_notification') detail = toolInput.channel ? `via ${toolInput.channel}` : '';
    if (toolName === 'summarize_document') detail = toolInput.style || 'brief';
    if (toolName === 'calendar_action')   detail = toolInput.action || '';

    return { icon, label, detail };
  }

  /* ─────────────────────────────────────────────────────────
     9. CORE STREAM MESSAGE
     POST to /chat with full message history + tools.
     Handles SSE streaming, tool_use blocks, and retries.
     ───────────────────────────────────────────────────────── */

  async function streamMessage({
    messages,
    mode        = 'balanced',
    temperature = null,
    maxTokens   = 1024,
    onChunk,
    onComplete,
    onToolCall,
    _retryCount = 0,
  }) {
    const base = getBackendUrl();

    if (!base) {
      throw new Error('No backend URL configured. Open Settings and enter your Railway URL.');
    }

    /* Resolve temperature from mode if not explicit */
    const temp = temperature !== null
      ? temperature
      : (MODE_TEMP[mode] ?? 0.7);

    /* Get custom instructions from settings */
    let customInstructions = '';
    try {
      const s = JSON.parse(localStorage.getItem('altas_settings') || '{}');
      customInstructions = s.systemPrompt || '';
      if (s.maxTokens) maxTokens = s.maxTokens;
    } catch { /* ignore */ }

    /* Build payload */
    const payload = {
      model:       CONFIG.model,
      max_tokens:  maxTokens,
      temperature: temp,
      system:      buildSystemPrompt(customInstructions),
      messages:    _sanitiseMessages(messages),
      tools:       TOOLS,
      tool_choice: { type: 'auto' },
      stream:      true,
    };

    /* Create abort controller */
    activeController = new AbortController();

    let response;
    try {
      response = await fetch(`${base}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  activeController.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;

      /* Network error — retry */
      if (_retryCount < CONFIG.maxRetries) {
        await _delay(CONFIG.retryDelayMs * (_retryCount + 1));
        return streamMessage({ messages, mode, temperature, maxTokens, onChunk, onComplete, onToolCall, _retryCount: _retryCount + 1 });
      }

      throw new Error(`Network error: ${err.message}. Check your internet connection.`);
    }

    /* HTTP error handling */
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      const status  = response.status;

      if (status === 401) throw new Error('Invalid API key — check your Railway environment variables.');
      if (status === 429) {
        if (_retryCount < CONFIG.maxRetries) {
          const wait = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
          ALTAS.Toast.info(`Rate limited — retrying in ${Math.round(wait/1000)}s…`);
          await _delay(wait);
          return streamMessage({ messages, mode, temperature, maxTokens, onChunk, onComplete, onToolCall, _retryCount: _retryCount + 1 });
        }
        throw new Error('Rate limited — too many requests. Please wait a moment.');
      }
      if (status === 500) throw new Error('Backend error — check your Railway deployment logs.');
      if (status === 503) throw new Error('ALTAS backend is unavailable. Try again shortly.');

      throw new Error(`Request failed (${status}): ${_extractError(errBody)}`);
    }

    /* ── SSE streaming reader ── */
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    let fullText     = '';
    let toolCalls    = [];
    let currentTool  = null;
    let inputBuffer  = '';
    let usage        = null;
    let stopReason   = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw   = decoder.decode(value, { stream: true });
        const lines = raw.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          let event;
          try { event = JSON.parse(data); }
          catch { continue; }

          /* ── Handle SSE event types ── */

          /* Content block start */
          if (event.type === 'content_block_start') {
            const block = event.content_block;

            if (block.type === 'tool_use') {
              currentTool  = { id: block.id, name: block.name, input: {} };
              inputBuffer  = '';

              /* Notify chat.js to render a tool call indicator */
              const formatted = formatToolCall(block.name, {});
              onToolCall?.({ ...currentTool, ...formatted, phase: 'start' });
            }
          }

          /* Content block delta */
          if (event.type === 'content_block_delta') {
            const delta = event.delta;

            /* Text delta — main response */
            if (delta.type === 'text_delta') {
              fullText += delta.text;
              onChunk?.(delta.text, fullText);
            }

            /* Tool input JSON accumulation */
            if (delta.type === 'input_json_delta') {
              inputBuffer += delta.partial_json;
            }
          }

          /* Content block stop */
          if (event.type === 'content_block_stop') {
            if (currentTool && inputBuffer) {
              try {
                currentTool.input = JSON.parse(inputBuffer);
              } catch {
                currentTool.input = { raw: inputBuffer };
              }
              toolCalls.push({ ...currentTool });

              /* Update tool call indicator with parsed input */
              const formatted = formatToolCall(currentTool.name, currentTool.input);
              onToolCall?.({ ...currentTool, ...formatted, phase: 'complete' });

              currentTool = null;
              inputBuffer = '';
            }
          }

          /* Message delta — stop reason + usage */
          if (event.type === 'message_delta') {
            stopReason = event.delta?.stop_reason;
            if (event.usage) usage = event.usage;
          }

          /* Message stop */
          if (event.type === 'message_stop') {
            break;
          }

          /* Error event from backend */
          if (event.type === 'error') {
            throw new Error(event.error?.message || 'Stream error from backend');
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    /* ── Tool use stop — handle tool results ── */
    if (stopReason === 'tool_use' && toolCalls.length > 0) {
      /* For now: render tool calls in chat and continue with a follow-up.
         Phase 9 (backend) will wire actual tool execution results back.
         This is the client-side stub that renders the call and waits. */
      const toolResultMessages = _buildToolResultMessages(messages, fullText, toolCalls);

      /* Continue conversation with tool results */
      return streamMessage({
        messages:    toolResultMessages,
        mode,
        temperature: temp,
        maxTokens,
        onChunk,
        onComplete,
        onToolCall,
        _retryCount: 0,
      });
    }

    /* ── End of stream ── */
    onComplete?.(fullText, usage);
    return fullText;
  }

  /* ─────────────────────────────────────────────────────────
     10. TOOL RESULT MESSAGE BUILDER
     Constructs the messages array with tool results inserted.
     Backend handles actual execution — this prepares the
     message structure Claude expects after tool_use.
     ───────────────────────────────────────────────────────── */

  function _buildToolResultMessages(previousMessages, assistantText, toolCalls) {
    /* Reconstruct the assistant turn with tool_use blocks */
    const assistantContent = [];

    if (assistantText) {
      assistantContent.push({ type: 'text', text: assistantText });
    }

    toolCalls.forEach(tc => {
      assistantContent.push({
        type:  'tool_use',
        id:    tc.id,
        name:  tc.name,
        input: tc.input,
      });
    });

    /* Build tool_result blocks — backend will fill actual results.
       Client sends placeholder results; real results injected server-side. */
    const toolResults = toolCalls.map(tc => ({
      type:        'tool_result',
      tool_use_id: tc.id,
      content:     `[Tool ${tc.name} executed — awaiting backend result]`,
    }));

    return [
      ...previousMessages,
      { role: 'assistant', content: assistantContent },
      { role: 'user',      content: toolResults },
    ];
  }

  /* ─────────────────────────────────────────────────────────
     11. MESSAGE SANITISER
     Ensures message array is valid before sending to API.
     Removes empty messages, fixes role alternation.
     ───────────────────────────────────────────────────────── */

  function _sanitiseMessages(messages) {
    if (!Array.isArray(messages)) return [];

    /* Filter out empty messages */
    let clean = messages.filter(m =>
      m && m.role && m.content &&
      (typeof m.content === 'string'
        ? m.content.trim().length > 0
        : Array.isArray(m.content) && m.content.length > 0)
    );

    /* Ensure no consecutive same-role messages
       (merge them if they appear) */
    const merged = [];
    for (const msg of clean) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role && typeof msg.content === 'string') {
        if (typeof last.content === 'string') {
          last.content += '\n' + msg.content;
        }
      } else {
        merged.push({ role: msg.role, content: msg.content });
      }
    }

    /* Must start with user message */
    if (merged.length > 0 && merged[0].role !== 'user') {
      merged.shift();
    }

    return merged;
  }

  /* ─────────────────────────────────────────────────────────
     12. ERROR EXTRACTION
     ───────────────────────────────────────────────────────── */

  function _extractError(body) {
    try {
      const obj = JSON.parse(body);
      return obj.error?.message || obj.message || body;
    } catch {
      return body || 'Unknown error';
    }
  }

  /* ─────────────────────────────────────────────────────────
     13. DELAY HELPER
     ───────────────────────────────────────────────────────── */

  function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* ─────────────────────────────────────────────────────────
     14. PUBLIC API
     ───────────────────────────────────────────────────────── */

  return {
    ping,
    abort,
    setBackendUrl,
    getBackendUrl,
    streamMessage,
    parseSlashCommand,
    formatToolCall,
    TOOLS,
  };

})();
