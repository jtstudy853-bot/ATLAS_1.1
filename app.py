# ═══════════════════════════════════════════════════════════════
# ALTAS — APP.PY
# Flask backend · Anthropic streaming · CORS · Tool execution
# All 10 tools: run_code, web_search, read_file, write_file,
# memory_store, memory_recall, github_action, send_notification,
# summarize_document, calendar_action
#
# Deploy on Railway:
#   ANTHROPIC_API_KEY = your key from console.anthropic.com
#   MODEL_NAME        = claude-haiku-4-5-20251001
#   PORT              = 5000
# ═══════════════════════════════════════════════════════════════

import os
import json
import time
import subprocess
import tempfile
import traceback
from datetime import datetime, timedelta
from typing import Generator

import anthropic
import requests
from dotenv import load_dotenv
from flask import Flask, Response, request, jsonify, stream_with_context

load_dotenv()

# ─── App init ───────────────────────────────────────────────────
app = Flask(__name__)

# ─── Config ─────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_NAME        = os.environ.get("MODEL_NAME", "claude-haiku-4-5-20251001")
PORT              = int(os.environ.get("PORT", 5000))

if not ANTHROPIC_API_KEY:
    print("⚠  WARNING: ANTHROPIC_API_KEY not set. /chat will return 401.")

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# ─── In-memory stores (replace with DB for persistence) ─────────
MEMORY_STORE: dict = {}         # key → {value, tags, updated_at}
CALENDAR_EVENTS: list = []      # list of event dicts

# ═══════════════════════════════════════════════════════════════
# CORS — manual implementation (flask-cors alone unreliable on Railway)
# ═══════════════════════════════════════════════════════════════

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "https://localhost:3000",
    # GitHub Pages domain — update to your actual domain
    "https://*.github.io",
]

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")

    # Allow GitHub Pages, localhost, file://, and Render preview URLs
    allowed = (
        not origin                           # file:// has no origin header
        or origin == "null"                  # some browsers send "null" for file://
        or origin.endswith(".github.io")
        or origin.startswith("http://localhost")
        or origin.startswith("http://127.0.0.1")
        or origin.startswith("https://localhost")
        or "onrender.com" in origin          # Render preview / service URLs
    )

    if allowed or not origin:
        response.headers["Access-Control-Allow-Origin"]      = origin or "*"
        response.headers["Access-Control-Allow-Methods"]     = "GET, POST, OPTIONS, DELETE"
        response.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization, X-Requested-With"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Max-Age"]           = "86400"

    return response

@app.before_request
def handle_preflight():
    """Handle CORS preflight OPTIONS requests."""
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        origin = request.headers.get("Origin", "")
        response.headers["Access-Control-Allow-Origin"]  = origin or "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, DELETE"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Max-Age"]       = "86400"
        return response


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

@app.route("/ping", methods=["GET"])
def ping():
    """Health check — frontend calls this on boot."""
    return jsonify({
        "status": "ok",
        "model":  MODEL_NAME,
        "time":   datetime.utcnow().isoformat(),
        "tools":  10,
    })


@app.route("/chat", methods=["POST"])
def chat():
    """
    Main streaming chat endpoint.
    Receives the full Anthropic-compatible payload from api.js,
    proxies it to the Anthropic API with streaming,
    and forwards SSE events back to the client.
    Also intercepts tool_use blocks and executes tools server-side.
    """
    if not client:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    # Extract fields — api.js sends the full Anthropic payload
    messages     = data.get("messages", [])
    system       = data.get("system", "")
    model        = data.get("model", MODEL_NAME)
    max_tokens   = int(data.get("max_tokens", 1024))
    temperature  = float(data.get("temperature", 0.7))
    tools        = data.get("tools", [])
    tool_choice  = data.get("tool_choice", {"type": "auto"})
    stream_flag  = data.get("stream", True)

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    def generate() -> Generator[str, None, None]:
        """SSE generator — streams Anthropic events to client."""
        try:
            with client.messages.stream(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=messages,
                tools=tools if tools else anthropic.NOT_GIVEN,
                tool_choice=tool_choice if tools else anthropic.NOT_GIVEN,
            ) as stream:

                # Stream all raw SSE events from Anthropic → client
                for event in stream:
                    event_type = event.type

                    # ── text delta ──
                    if event_type == "content_block_delta":
                        delta = event.delta
                        if hasattr(delta, "text"):
                            payload = json.dumps({
                                "type":  "content_block_delta",
                                "index": event.index,
                                "delta": {"type": "text_delta", "text": delta.text},
                            })
                            yield f"data: {payload}\n\n"

                        elif hasattr(delta, "partial_json"):
                            payload = json.dumps({
                                "type":  "content_block_delta",
                                "index": event.index,
                                "delta": {
                                    "type":         "input_json_delta",
                                    "partial_json": delta.partial_json,
                                },
                            })
                            yield f"data: {payload}\n\n"

                    # ── block start ──
                    elif event_type == "content_block_start":
                        block = event.content_block
                        block_data = {"type": block.type}
                        if block.type == "tool_use":
                            block_data.update({
                                "id":   block.id,
                                "name": block.name,
                            })
                        payload = json.dumps({
                            "type":          "content_block_start",
                            "index":         event.index,
                            "content_block": block_data,
                        })
                        yield f"data: {payload}\n\n"

                    # ── block stop ──
                    elif event_type == "content_block_stop":
                        payload = json.dumps({
                            "type":  "content_block_stop",
                            "index": event.index,
                        })
                        yield f"data: {payload}\n\n"

                    # ── message delta (stop_reason, usage) ──
                    elif event_type == "message_delta":
                        delta_data = {}
                        if hasattr(event.delta, "stop_reason"):
                            delta_data["stop_reason"] = event.delta.stop_reason
                        usage_data = {}
                        if hasattr(event, "usage") and event.usage:
                            usage_data = {
                                "output_tokens": getattr(event.usage, "output_tokens", 0),
                            }
                        payload = json.dumps({
                            "type":  "message_delta",
                            "delta": delta_data,
                            "usage": usage_data,
                        })
                        yield f"data: {payload}\n\n"

                    # ── message start ──
                    elif event_type == "message_start":
                        msg = event.message
                        usage = {}
                        if hasattr(msg, "usage") and msg.usage:
                            usage = {
                                "input_tokens":  getattr(msg.usage, "input_tokens", 0),
                                "output_tokens": getattr(msg.usage, "output_tokens", 0),
                            }
                        payload = json.dumps({
                            "type": "message_start",
                            "message": {
                                "id":    msg.id,
                                "model": msg.model,
                                "role":  msg.role,
                                "usage": usage,
                            },
                        })
                        yield f"data: {payload}\n\n"

                    # ── message stop ──
                    elif event_type == "message_stop":
                        # Execute any tool calls that were accumulated
                        final_msg = stream.get_final_message()
                        tool_calls = _extract_tool_calls(final_msg)

                        if tool_calls:
                            # Execute tools and yield results as a special event
                            tool_results = _execute_tools(tool_calls)
                            payload = json.dumps({
                                "type":         "tool_results",
                                "tool_results": tool_results,
                            })
                            yield f"data: {payload}\n\n"

                        yield "data: {\"type\": \"message_stop\"}\n\n"
                        yield "data: [DONE]\n\n"
                        return

            yield "data: [DONE]\n\n"

        except anthropic.AuthenticationError:
            error_payload = json.dumps({
                "type":  "error",
                "error": {"message": "Invalid API key — check ANTHROPIC_API_KEY in Railway variables."},
            })
            yield f"data: {error_payload}\n\n"
            yield "data: [DONE]\n\n"

        except anthropic.RateLimitError:
            error_payload = json.dumps({
                "type":  "error",
                "error": {"message": "Rate limited by Anthropic — please wait and retry."},
            })
            yield f"data: {error_payload}\n\n"
            yield "data: [DONE]\n\n"

        except anthropic.APIStatusError as e:
            error_payload = json.dumps({
                "type":  "error",
                "error": {"message": f"Anthropic API error {e.status_code}: {e.message}"},
            })
            yield f"data: {error_payload}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            traceback.print_exc()
            error_payload = json.dumps({
                "type":  "error",
                "error": {"message": f"Backend error: {str(e)}"},
            })
            yield f"data: {error_payload}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":        "no-cache",
            "X-Accel-Buffering":    "no",   # Disable nginx buffering on Railway
            "Transfer-Encoding":    "chunked",
            "Connection":           "keep-alive",
        },
    )


# ═══════════════════════════════════════════════════════════════
# TOOL EXECUTION
# ═══════════════════════════════════════════════════════════════

def _extract_tool_calls(message) -> list:
    """Pull tool_use blocks from a completed Anthropic message."""
    calls = []
    if not message or not hasattr(message, "content"):
        return calls
    for block in message.content:
        if hasattr(block, "type") and block.type == "tool_use":
            calls.append({
                "id":    block.id,
                "name":  block.name,
                "input": block.input if hasattr(block, "input") else {},
            })
    return calls


def _execute_tools(tool_calls: list) -> list:
    """
    Execute each tool call and return results.
    Returns list of {tool_use_id, content} dicts.
    """
    results = []
    for call in tool_calls:
        tool_id   = call["id"]
        tool_name = call["name"]
        tool_input = call.get("input", {})

        try:
            result = _dispatch_tool(tool_name, tool_input)
        except Exception as e:
            result = f"Tool error ({tool_name}): {str(e)}"

        results.append({
            "type":        "tool_result",
            "tool_use_id": tool_id,
            "content":     str(result),
        })

    return results


def _dispatch_tool(name: str, inp: dict) -> str:
    """Route tool calls to their implementations."""
    dispatch = {
        "run_code":           _tool_run_code,
        "web_search":         _tool_web_search,
        "read_file":          _tool_read_file,
        "write_file":         _tool_write_file,
        "memory_store":       _tool_memory_store,
        "memory_recall":      _tool_memory_recall,
        "github_action":      _tool_github_action,
        "send_notification":  _tool_send_notification,
        "summarize_document": _tool_summarize_document,
        "calendar_action":    _tool_calendar_action,
    }
    fn = dispatch.get(name)
    if not fn:
        return f"Unknown tool: {name}"
    return fn(inp)


# ─── Tool: run_code ─────────────────────────────────────────────

def _tool_run_code(inp: dict) -> str:
    language = inp.get("language", "python").lower()
    code     = inp.get("code", "")
    timeout  = min(int(inp.get("timeout_seconds", 10)), 30)  # Cap at 30s

    if not code.strip():
        return "No code provided."

    lang_map = {
        "python":     ["python3", "-c"],
        "javascript": ["node",    "-e"],
        "typescript": ["ts-node", "-e"],
        "bash":       ["bash",    "-c"],
    }

    cmd_prefix = lang_map.get(language)
    if not cmd_prefix:
        return f"Unsupported language: {language}. Supported: python, javascript, bash."

    try:
        result = subprocess.run(
            cmd_prefix + [code],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        exit_code = result.returncode

        output = f"Exit code: {exit_code}\n"
        if stdout:
            output += f"\nStdout:\n{stdout}"
        if stderr:
            output += f"\nStderr:\n{stderr}"
        if not stdout and not stderr:
            output += "\n(no output)"

        return output

    except subprocess.TimeoutExpired:
        return f"Code execution timed out after {timeout} seconds."
    except FileNotFoundError:
        return f"Runtime not found for {language}. Make sure it is installed on the server."
    except Exception as e:
        return f"Execution error: {str(e)}"


# ─── Tool: web_search ───────────────────────────────────────────

def _tool_web_search(inp: dict) -> str:
    query       = inp.get("query", "").strip()
    num_results = min(int(inp.get("num_results", 5)), 10)

    if not query:
        return "No search query provided."

    # Use DuckDuckGo Instant Answer API (no key required)
    try:
        resp = requests.get(
            "https://api.duckduckgo.com/",
            params={
                "q":      query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            },
            timeout=8,
            headers={"User-Agent": "ALTAS/1.0 (personal AI assistant)"},
        )
        data = resp.json()

        results = []

        # Abstract (direct answer)
        if data.get("Abstract"):
            results.append(f"Summary: {data['Abstract']}")
            if data.get("AbstractURL"):
                results.append(f"Source: {data['AbstractURL']}")

        # Related topics
        for topic in data.get("RelatedTopics", [])[:num_results]:
            if isinstance(topic, dict) and topic.get("Text"):
                text = topic["Text"]
                url  = topic.get("FirstURL", "")
                results.append(f"• {text}" + (f"\n  {url}" if url else ""))

        if not results:
            return (
                f"No instant results found for '{query}'. "
                "Try a more specific query or use the summarize_document tool with a URL."
            )

        return f"Search results for '{query}':\n\n" + "\n\n".join(results[:num_results])

    except requests.Timeout:
        return f"Search timed out for query: '{query}'"
    except Exception as e:
        return f"Search error: {str(e)}"


# ─── Tool: read_file ────────────────────────────────────────────

def _tool_read_file(inp: dict) -> str:
    path       = inp.get("path", "").strip()
    start_line = inp.get("start_line")
    end_line   = inp.get("end_line")

    if not path:
        return "No file path provided."

    # Security: block absolute paths outside safe dirs in production
    # For personal use this is open — add restrictions as needed
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        if start_line or end_line:
            start = (int(start_line) - 1) if start_line else 0
            end   = int(end_line)          if end_line   else len(lines)
            lines = lines[start:end]

        content = "".join(lines)
        line_count = len(lines)

        return (
            f"File: {path}\n"
            f"Lines: {line_count}\n"
            f"{'─' * 40}\n"
            f"{content}"
        )

    except FileNotFoundError:
        return f"File not found: {path}"
    except PermissionError:
        return f"Permission denied: {path}"
    except Exception as e:
        return f"Error reading file: {str(e)}"


# ─── Tool: write_file ───────────────────────────────────────────

def _tool_write_file(inp: dict) -> str:
    path    = inp.get("path", "").strip()
    content = inp.get("content", "")
    mode    = inp.get("mode", "overwrite")

    if not path:
        return "No file path provided."

    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        write_mode = "a" if mode == "append" else "w"

        with open(path, write_mode, encoding="utf-8") as f:
            f.write(content)

        size = os.path.getsize(path)
        return (
            f"Successfully {'appended to' if mode == 'append' else 'wrote'} {path}\n"
            f"Size: {size} bytes"
        )

    except PermissionError:
        return f"Permission denied: {path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"


# ─── Tool: memory_store ─────────────────────────────────────────

def _tool_memory_store(inp: dict) -> str:
    key   = inp.get("key", "").strip().replace(" ", "_").lower()
    value = str(inp.get("value", "")).strip()
    tags  = [t.lower().strip() for t in (inp.get("tags") or [])]

    if not key:
        return "No key provided."
    if not value:
        return "No value provided."

    existed = key in MEMORY_STORE
    MEMORY_STORE[key] = {
        "value":      value,
        "tags":       tags,
        "updated_at": datetime.utcnow().isoformat(),
    }

    action = "Updated" if existed else "Stored"
    return (
        f"{action} memory:\n"
        f"Key:   {key}\n"
        f"Value: {value}"
        + (f"\nTags:  {', '.join(tags)}" if tags else "")
    )


# ─── Tool: memory_recall ────────────────────────────────────────

def _tool_memory_recall(inp: dict) -> str:
    key   = inp.get("key", "").strip()
    tag   = inp.get("tag", "").strip().lower()
    query = inp.get("query", "").strip().lower()

    if not MEMORY_STORE:
        return "Memory bank is empty."

    results = []

    # Exact key lookup
    if key and key in MEMORY_STORE:
        entry = MEMORY_STORE[key]
        results.append(f"• {key}: {entry['value']}")

    # Tag lookup
    elif tag:
        for k, v in MEMORY_STORE.items():
            if tag in v.get("tags", []):
                results.append(f"• {k}: {v['value']}")

    # Fuzzy query
    elif query:
        for k, v in MEMORY_STORE.items():
            searchable = f"{k} {v['value']} {' '.join(v.get('tags', []))}".lower()
            if query in searchable:
                results.append(f"• {k}: {v['value']}")

    # Return all
    else:
        for k, v in list(MEMORY_STORE.items())[:20]:
            results.append(f"• {k}: {v['value']}")

    if not results:
        lookup = key or tag or query or "all entries"
        return f"No memories found for: {lookup}"

    return f"Recalled {len(results)} memor{'y' if len(results)==1 else 'ies'}:\n\n" + "\n".join(results)


# ─── Tool: github_action ────────────────────────────────────────

def _tool_github_action(inp: dict) -> str:
    action = inp.get("action", "").strip()
    repo   = inp.get("repo", "").strip()
    params = inp.get("params", {}) or {}

    github_token = os.environ.get("GITHUB_TOKEN", "")
    if not github_token:
        return (
            "GitHub token not configured. "
            "Add GITHUB_TOKEN to your Railway environment variables."
        )

    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept":        "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    base = "https://api.github.com"

    try:
        if action == "list_repos":
            resp = requests.get(f"{base}/user/repos?sort=updated&per_page=20", headers=headers, timeout=8)
            repos = resp.json()
            if isinstance(repos, list):
                lines = [f"• {r['full_name']} ({'private' if r['private'] else 'public'})" for r in repos]
                return f"Your repositories ({len(lines)}):\n\n" + "\n".join(lines)
            return str(repos)

        elif action == "get_issue":
            issue_num = params.get("issue_number") or params.get("number")
            if not repo or not issue_num:
                return "Requires repo and issue_number."
            resp = requests.get(f"{base}/repos/{repo}/issues/{issue_num}", headers=headers, timeout=8)
            issue = resp.json()
            return (
                f"Issue #{issue.get('number')}: {issue.get('title')}\n"
                f"State: {issue.get('state')}\n"
                f"Author: {issue.get('user', {}).get('login')}\n"
                f"Body:\n{issue.get('body', '(no body)')}"
            )

        elif action == "create_issue":
            if not repo:
                return "Requires repo."
            title = params.get("title", "New issue")
            body  = params.get("body", "")
            resp = requests.post(
                f"{base}/repos/{repo}/issues",
                headers=headers,
                json={"title": title, "body": body},
                timeout=8,
            )
            issue = resp.json()
            return f"Created issue #{issue.get('number')}: {issue.get('html_url')}"

        elif action == "list_prs":
            if not repo:
                return "Requires repo."
            resp = requests.get(f"{base}/repos/{repo}/pulls?state=open&per_page=10", headers=headers, timeout=8)
            prs = resp.json()
            if isinstance(prs, list):
                lines = [f"• #{pr['number']} {pr['title']} by @{pr['user']['login']}" for pr in prs]
                return f"Open PRs for {repo} ({len(lines)}):\n\n" + "\n".join(lines) if lines else "No open PRs."
            return str(prs)

        elif action == "get_file":
            path   = params.get("path", "")
            branch = params.get("branch", "main")
            if not repo or not path:
                return "Requires repo and path."
            resp = requests.get(f"{base}/repos/{repo}/contents/{path}?ref={branch}", headers=headers, timeout=8)
            file_data = resp.json()
            if "content" in file_data:
                import base64
                content = base64.b64decode(file_data["content"]).decode("utf-8", errors="replace")
                return f"File: {path}\n{'─'*40}\n{content}"
            return str(file_data)

        elif action == "get_commits":
            if not repo:
                return "Requires repo."
            per_page = min(int(params.get("per_page", 10)), 30)
            resp = requests.get(f"{base}/repos/{repo}/commits?per_page={per_page}", headers=headers, timeout=8)
            commits = resp.json()
            if isinstance(commits, list):
                lines = [
                    f"• {c['sha'][:7]} {c['commit']['message'].splitlines()[0]} — @{c['commit']['author']['name']}"
                    for c in commits
                ]
                return f"Recent commits for {repo}:\n\n" + "\n".join(lines)
            return str(commits)

        else:
            return f"Unknown GitHub action: {action}. Valid: list_repos, get_issue, create_issue, list_prs, get_file, get_commits."

    except requests.Timeout:
        return "GitHub API request timed out."
    except Exception as e:
        return f"GitHub error: {str(e)}"


# ─── Tool: send_notification ────────────────────────────────────

def _tool_send_notification(inp: dict) -> str:
    channel      = inp.get("channel", "push")
    message      = inp.get("message", "").strip()
    title        = inp.get("title", "ALTAS Notification").strip()
    schedule_at  = inp.get("schedule_at")

    if not message:
        return "No notification message provided."

    # Log the notification (replace with real push/email integration)
    scheduled = f" (scheduled: {schedule_at})" if schedule_at else ""
    log_entry = {
        "channel":     channel,
        "title":       title,
        "message":     message,
        "schedule_at": schedule_at,
        "sent_at":     datetime.utcnow().isoformat(),
    }
    print(f"[NOTIFICATION] {json.dumps(log_entry)}")

    # Webhook delivery
    webhook_url = os.environ.get("NOTIFICATION_WEBHOOK_URL", "")
    if channel == "webhook" and webhook_url:
        try:
            requests.post(webhook_url, json=log_entry, timeout=5)
            return f"Notification sent via webhook{scheduled}:\nTitle: {title}\n{message}"
        except Exception as e:
            return f"Webhook delivery failed: {str(e)}"

    return (
        f"Notification queued{scheduled}:\n"
        f"Channel: {channel}\n"
        f"Title:   {title}\n"
        f"Message: {message}\n\n"
        f"(Connect a real delivery service via NOTIFICATION_WEBHOOK_URL in Railway)"
    )


# ─── Tool: summarize_document ───────────────────────────────────

def _tool_summarize_document(inp: dict) -> str:
    source = inp.get("source", "").strip()
    style  = inp.get("style", "brief")
    focus  = inp.get("focus", "")

    if not source:
        return "No source provided."

    content = ""

    # Fetch URL
    if source.startswith("http://") or source.startswith("https://"):
        try:
            resp = requests.get(
                source,
                timeout=10,
                headers={"User-Agent": "ALTAS/1.0"},
            )
            resp.raise_for_status()

            # Strip HTML tags simply
            import re
            html = resp.text
            text = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.DOTALL)
            text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            content = text[:8000]  # Feed up to 8k chars to model
        except Exception as e:
            return f"Could not fetch URL: {str(e)}"
    else:
        # Raw text passed directly
        content = source[:8000]

    if not content:
        return "No content found to summarise."

    # Use the Anthropic model to summarise
    if not client:
        return "Cannot summarise: ANTHROPIC_API_KEY not configured."

    style_instructions = {
        "brief":         "Summarise in 2-3 sentences.",
        "detailed":      "Provide a detailed summary with key points.",
        "bullet_points": "Summarise as a bullet-point list of key takeaways.",
        "eli5":          "Explain this simply, as if to a 10-year-old.",
    }
    instruction = style_instructions.get(style, style_instructions["brief"])
    focus_note  = f" Focus on: {focus}." if focus else ""

    try:
        msg = client.messages.create(
            model=MODEL_NAME,
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": f"{instruction}{focus_note}\n\nContent:\n{content}",
            }],
        )
        return msg.content[0].text
    except Exception as e:
        return f"Summarisation error: {str(e)}"


# ─── Tool: calendar_action ──────────────────────────────────────

def _tool_calendar_action(inp: dict) -> str:
    action     = inp.get("action", "")
    event_data = inp.get("event", {}) or {}
    date_range = inp.get("date_range", {}) or {}

    if action == "create_event":
        if not event_data.get("title"):
            return "Event title is required."

        event = {
            "id":          f"evt_{int(time.time())}",
            "title":       event_data.get("title", ""),
            "start":       event_data.get("start", datetime.utcnow().isoformat()),
            "end":         event_data.get("end",   ""),
            "description": event_data.get("description", ""),
            "location":    event_data.get("location", ""),
            "created_at":  datetime.utcnow().isoformat(),
        }
        CALENDAR_EVENTS.append(event)

        return (
            f"Event created:\n"
            f"Title:    {event['title']}\n"
            f"Start:    {event['start']}\n"
            + (f"End:      {event['end']}\n"         if event['end']         else "")
            + (f"Location: {event['location']}\n"    if event['location']    else "")
            + (f"Notes:    {event['description']}\n" if event['description'] else "")
            + f"ID:       {event['id']}"
        )

    elif action == "list_events":
        if not CALENDAR_EVENTS:
            return "No events in calendar."

        # Filter by date range if provided
        events = CALENDAR_EVENTS

        if date_range.get("start"):
            try:
                start_dt = datetime.fromisoformat(date_range["start"].replace("Z", "+00:00"))
                events = [e for e in events if _parse_dt(e["start"]) >= start_dt]
            except Exception:
                pass

        if date_range.get("end"):
            try:
                end_dt = datetime.fromisoformat(date_range["end"].replace("Z", "+00:00"))
                events = [e for e in events if _parse_dt(e["start"]) <= end_dt]
            except Exception:
                pass

        if not events:
            return "No events in the specified date range."

        lines = []
        for e in sorted(events, key=lambda x: x["start"])[:20]:
            lines.append(
                f"• {e['title']}"
                + (f" — {e['start'][:16]}" if e["start"] else "")
                + (f" @ {e['location']}"   if e["location"] else "")
            )

        return f"Calendar events ({len(lines)}):\n\n" + "\n".join(lines)

    elif action == "delete_event":
        event_id = inp.get("event_id") or (event_data.get("id") if event_data else None)
        if not event_id:
            return "Event ID required for deletion."

        before = len(CALENDAR_EVENTS)
        CALENDAR_EVENTS[:] = [e for e in CALENDAR_EVENTS if e["id"] != event_id]

        if len(CALENDAR_EVENTS) < before:
            return f"Event {event_id} deleted."
        return f"Event {event_id} not found."

    else:
        return f"Unknown calendar action: {action}. Valid: create_event, list_events, delete_event."


def _parse_dt(s: str):
    """Parse ISO datetime string to datetime object, forgiving."""
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.min


# ═══════════════════════════════════════════════════════════════
# MEMORY API ROUTES
# Expose memory to frontend for the Memory panel in the sidebar
# ═══════════════════════════════════════════════════════════════

@app.route("/memory", methods=["GET"])
def get_memory():
    """Return all server-side memory entries."""
    entries = [
        {
            "key":        k,
            "value":      v["value"],
            "tags":       v.get("tags", []),
            "updated_at": v.get("updated_at", ""),
        }
        for k, v in MEMORY_STORE.items()
    ]
    return jsonify({"entries": entries, "count": len(entries)})


@app.route("/memory/<key>", methods=["DELETE"])
def delete_memory(key):
    """Delete a memory entry by key."""
    if key in MEMORY_STORE:
        del MEMORY_STORE[key]
        return jsonify({"deleted": key})
    return jsonify({"error": f"Key not found: {key}"}), 404


@app.route("/memory", methods=["POST"])
def upsert_memory():
    """Upsert a memory entry from the frontend panel."""
    data = request.get_json(silent=True) or {}
    result = _tool_memory_store(data)
    return jsonify({"result": result})


# ═══════════════════════════════════════════════════════════════
# CALENDAR API ROUTES
# ═══════════════════════════════════════════════════════════════

@app.route("/calendar", methods=["GET"])
def get_calendar():
    """Return all calendar events."""
    return jsonify({"events": CALENDAR_EVENTS, "count": len(CALENDAR_EVENTS)})


# ═══════════════════════════════════════════════════════════════
# ERROR HANDLERS
# ═══════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Route not found", "status": 404}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed", "status": 405}), 405


@app.errorhandler(500)
def internal_error(e):
    traceback.print_exc()
    return jsonify({"error": "Internal server error", "status": 500}), 500


# ═══════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"ALTAS backend starting on port {PORT}")
    print(f"Model: {MODEL_NAME}")
    print(f"API key: {'✓ set' if ANTHROPIC_API_KEY else '✗ MISSING — set ANTHROPIC_API_KEY'}")
    app.run(
        host="0.0.0.0",
        port=PORT,
        debug=False,
        threaded=True,
    )
