#!/usr/bin/env node
// TheChambers: a password-gated web chat for Command Code, meant to be reached from a phone
// over Tailscale. It shells out to headless mode (`cmdc -p --output-format json`) and
// forwards the NDJSON frames to the browser as Server-Sent Events.
//
// It reads Command Code's own session transcripts directly, so a conversation started in a
// terminal shows up here, and a message sent here continues that same session.
//
// No dependencies. Node 22+.

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), '.config', 'thechambers');
const PASSWORD_FILE = path.join(CONFIG_DIR, 'ui-password.txt');
const SECRET_FILE = path.join(CONFIG_DIR, 'secret.txt');
const CONVERSATIONS_FILE = path.join(CONFIG_DIR, 'conversations.json');

const env = (name, legacy, fallback) => process.env[name] || (legacy ? process.env[legacy] : undefined) || fallback;

const PORT = Number(env('THECHAMBERS_PORT', 'CMDC_WEB_PORT', 3002));
const WORKSPACE = path.resolve(env('THECHAMBERS_WORKSPACE', 'CMDC_WEB_WORKSPACE', os.homedir()));
const MAX_TURNS = String(env('THECHAMBERS_MAX_TURNS', 'CMDC_WEB_MAX_TURNS', 60));
const VERSION = '1.1.0';
// A session touched this recently is almost certainly still open in a terminal.
const LIVE_WINDOW_MS = 120000;

fs.mkdirSync(CONFIG_DIR, {recursive: true});

// ---------------------------------------------------------------------------
// Local secrets
// ---------------------------------------------------------------------------

function ensureFile(file, make) {
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').trim()) {
    fs.writeFileSync(file, make() + '\n', {mode: 0o600});
    console.log(`[thechambers] Created ${file}`);
  }
  return fs.readFileSync(file, 'utf8').trim();
}

const PASSWORD = ensureFile(PASSWORD_FILE, () => crypto.randomBytes(24).toString('base64url'));
const SECRET = ensureFile(SECRET_FILE, () => crypto.randomBytes(32).toString('hex'));

if (PASSWORD.length < 16) {
  console.error(`[thechambers] The password in ${PASSWORD_FILE} is shorter than 16 characters. Refusing to start.`);
  process.exit(1);
}

// Cookie value is derived, so the password itself never lands in the browser.
const SESSION_TOKEN = crypto.createHmac('sha256', SECRET).update('thechambers-session-v1').digest('hex');
const COOKIE_NAME = 'thechambers';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {conversations: [], workspaces: []};
try {
  if (fs.existsSync(CONVERSATIONS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
    if (Array.isArray(parsed.conversations)) {
      state = {
        conversations: parsed.conversations,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      };
    }
  }
} catch (err) {
  console.error(`[thechambers] Ignoring unreadable ${CONVERSATIONS_FILE}: ${err.message}`);
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error(`[thechambers] Could not save conversations: ${err.message}`);
    }
  }, 250);
}

const running = new Map(); // conversationId -> {child, assistant, wasStopped}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendEvent(res, payload) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    /* client went away; the run keeps going and lands in history */
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(SESSION_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const passwordAttempts = new Map(); // ip -> {count, until}

function loginAllowed(ip) {
  const entry = passwordAttempts.get(ip);
  if (!entry) return true;
  if (entry.until && Date.now() > entry.until) {
    passwordAttempts.delete(ip);
    return true;
  }
  return entry.count < 10;
}

function noteLoginFailure(ip) {
  const entry = passwordAttempts.get(ip) || {count: 0, until: 0};
  entry.count += 1;
  if (entry.count >= 10) entry.until = Date.now() + 10 * 60 * 1000;
  passwordAttempts.set(ip, entry);
}

// The CLI is a .cmd shim on Windows, which Node refuses to spawn without a shell. Running the
// bundled entry point through this same node binary avoids the shell entirely; the prompt goes
// in on stdin so no user text ever reaches an argument list.
function resolveCliEntry() {
  if (process.env.CMDC_ENTRY) return process.env.CMDC_ENTRY;
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'command-code', 'dist', 'index.mjs'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'command-code', 'dist', 'index.mjs'),
    '/usr/local/lib/node_modules/command-code/dist/index.mjs',
    '/usr/lib/node_modules/command-code/dist/index.mjs',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const CLI_ENTRY = resolveCliEntry();

function spawnCmdc(args, cwd) {
  const options = {
    cwd: cwd || WORKSPACE,
    env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'},
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  if (CLI_ENTRY) return spawn(process.execPath, [CLI_ENTRY, ...args], options);
  return spawn('cmdc', args, {...options, shell: true});
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true});
  } else {
    child.kill('SIGTERM');
  }
}

function publicConversation(conv) {
  return {
    id: conv.id,
    title: conv.title,
    sessionId: conv.sessionId || null,
    workspace: conv.workspace || WORKSPACE,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    running: running.has(conv.id),
  };
}

function findConversation(id) {
  return state.conversations.find((conv) => conv.id === id) || null;
}

function findConversationBySession(sessionId) {
  return state.conversations.find((conv) => conv.sessionId === sessionId) || null;
}

function makeConversation({title, workspace, sessionId} = {}) {
  const conv = {
    id: crypto.randomUUID(),
    sessionId: sessionId || null,
    title: title || 'New conversation',
    workspace: workspace || WORKSPACE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.conversations.unshift(conv);
  persist();
  return conv;
}

function summariseInput(input) {
  if (input === undefined || input === null) return '';
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return text.length > 240 ? `${text.slice(0, 240)}â€¦` : text;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Command Code's own sessions
//
// `~/.commandcode/projects/<slug>/<id>.jsonl` holds every session this machine has ever run,
// one project directory per working directory. Reading them directly means the web app shows
// the same work you started in a terminal, and resuming uses the real transcript instead of a
// parallel copy of the conversation.
// ---------------------------------------------------------------------------

const SESSIONS_ROOT = path.join(os.homedir(), '.commandcode', 'projects');

function normalisePath(value) {
  return path
    .resolve(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

function workspaceFromInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const resolved = path.resolve(value.trim());
    if (!fs.statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

const headerCache = new Map(); // transcript file -> {mtimeMs, header, meta}

function readSessionFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = headerCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

  let header = null;
  try {
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const firstLine = buffer.subarray(0, bytes).toString('utf8').split('\n')[0];
    header = JSON.parse(firstLine);
  } catch {
    header = null;
  }

  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
  } catch {
    meta = {};
  }

  const record = {mtimeMs: stat.mtimeMs, size: stat.size, header, meta};
  headerCache.set(file, record);
  return record;
}

let indexCache = {at: 0, index: new Map()};

function sessionIndex() {
  if (indexCache.at && Date.now() - indexCache.at < 4000) return indexCache.index;
  const index = new Map();
  let dirs = [];
  try {
    dirs = fs.readdirSync(SESSIONS_ROOT, {withFileTypes: true}).filter((entry) => entry.isDirectory());
  } catch {
    indexCache = {at: Date.now(), index};
    return index;
  }

  for (const dir of dirs) {
    const dirPath = path.join(SESSIONS_ROOT, dir.name);
    let files = [];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      if (/\.(checkpoints|prompts|share)\.jsonl$/.test(name)) continue;
      const file = path.join(dirPath, name);
      const record = readSessionFile(file);
      if (!record || !record.header || !record.header.cwd) continue;
      const id = name.slice(0, -'.jsonl'.length);
      index.set(id, {
        id,
        file,
        cwd: record.header.cwd,
        createdAt: record.header.timestamp || new Date(record.mtimeMs).toISOString(),
        updatedAt: record.mtimeMs,
        title: (record.meta && record.meta.title) || '',
        model: (record.meta && record.meta.model) || null,
      });
    }
  }

  indexCache = {at: Date.now(), index};
  return index;
}

function invalidateSessionIndex() {
  indexCache = {at: 0, index: new Map()};
}

function sessionsFor(workspace) {
  const wanted = workspace ? normalisePath(workspace) : null;
  const all = [...sessionIndex().values()];
  return all
    .filter((item) => !wanted || normalisePath(item.cwd) === wanted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Walks the transcript's parent chain from the newest entry backwards, so what the phone shows
// is the branch that is actually active - the same rule /tree and /rewind use.
//
// Results are cached by file mtime + size: the conversation view polls this while a terminal is
// writing to the same session, and re-parsing a multi-megabyte transcript every two seconds
// would be wasteful. A new byte written by any process invalidates the entry.
const transcriptCache = new Map(); // transcript file -> {mtimeMs, size, messages}

function readTranscript(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }

  const cached = transcriptCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.messages;

  let text = '';
  try {
    const cap = 4 * 1024 * 1024;
    const start = stat.size > cap ? stat.size - cap : 0;
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    text = buffer.toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
  } catch {
    return [];
  }

  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message) entries.push(entry);
    } catch {
      /* corrupt line: skip it, same as the CLI does */
    }
  }
  if (!entries.length) return [];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chain = [];
  const seen = new Set();
  let cursor = entries[entries.length - 1];
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  chain.reverse();

  const messages = [];
  const toolsById = new Map();

  for (const entry of chain) {
    const message = entry.message || {};
    const content = Array.isArray(message.content) ? message.content : [];
    const source = message.meta && message.meta.source;
    const ts = Date.parse(entry.timestamp) || Date.now();

    if (source === 'tool') {
      for (const part of content) {
        if (part.type !== 'tool_result') continue;
        const tool = toolsById.get(part.tool_use_id);
        if (!tool) continue;
        const result = Array.isArray(part.content)
          ? part.content
              .filter((piece) => piece.type === 'text')
              .map((piece) => piece.text)
              .join('\n')
          : typeof part.content === 'string'
            ? part.content
            : '';
        tool.result = result.slice(0, 4000);
        tool.status = 'done';
      }
      continue;
    }

    if (message.role === 'user') {
      const userText = content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      if (userText.trim()) messages.push({role: 'user', text: userText, ts});
      continue;
    }

    if (message.role === 'assistant') {
      let target = messages[messages.length - 1];
      if (!target || target.role !== 'assistant') {
        target = {role: 'assistant', text: '', tools: [], ts};
        messages.push(target);
      }
      for (const part of content) {
        if (part.type === 'text' && part.text) {
          target.text = target.text ? `${target.text}\n${part.text}` : part.text;
        } else if (part.type === 'tool_use') {
          const tool = {
            id: part.id,
            name: part.name,
            input: summariseInput(part.input),
            status: 'done',
            result: null,
          };
          target.tools.push(tool);
          toolsById.set(part.id, tool);
        }
      }
      if (entry.model) target.model = entry.model;
      if (entry.usage) target.usage = entry.usage;
    }
  }

  const trimmed = messages.slice(-200);
  transcriptCache.set(file, {mtimeMs: stat.mtimeMs, size: stat.size, messages: trimmed});
  return trimmed;
}

function transcriptMessages(sessionId) {
  if (!sessionId) return [];
  const item = sessionIndex().get(sessionId);
  if (!item) return [];
  return readTranscript(item.file);
}

function latestUserText(sessionId) {
  const messages = transcriptMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user' && messages[i].text) return messages[i].text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// A turn
// ---------------------------------------------------------------------------

function handleFrame(frame, ctx) {
  if (!frame || typeof frame !== 'object') return;

  if (frame.type === 'event' && frame.event) {
    const ev = frame.event;
    switch (ev.type) {
      case 'text_delta':
        ctx.assistant.text += ev.delta;
        sendEvent(ctx.res, {t: 'text', d: ev.delta});
        break;

      case 'message_end': {
        const content = Array.isArray(ev.content) ? ev.content : [];
        const text = content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        if (text && !ctx.assistant.text) ctx.assistant.text = text;
        for (const part of content) {
          if (part.type !== 'tool_use') continue;
          ctx.assistant.tools.push({
            id: part.id,
            name: part.name,
            input: summariseInput(part.input),
            status: 'queued',
            result: null,
          });
        }
        break;
      }

      case 'tool_running': {
        const tool = ctx.assistant.tools.find((t) => t.id === ev.toolCallId);
        if (tool) {
          tool.status = 'running';
          if (ev.description) tool.description = ev.description;
        }
        sendEvent(ctx.res, {
          t: 'tool',
          id: ev.toolCallId,
          name: ev.toolName,
          status: 'running',
          description: ev.description || null,
        });
        break;
      }

      case 'tool_completed':
      case 'tool_errored':
      case 'tool_denied': {
        const tool = ctx.assistant.tools.find((t) => t.id === ev.toolCallId);
        const status =
          ev.type === 'tool_completed' ? 'done' : ev.type === 'tool_denied' ? 'denied' : 'error';
        const result = Array.isArray(ev.result)
          ? ev.result
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
          : typeof ev.result === 'string'
            ? ev.result
            : '';
        if (tool) {
          tool.status = status;
          tool.result = result.slice(0, 4000);
        }
        sendEvent(ctx.res, {
          t: 'tool',
          id: ev.toolCallId,
          name: ev.toolName,
          status,
          result: result.slice(0, 4000),
        });
        break;
      }

      case 'model_request_start':
        if (ev.model) sendEvent(ctx.res, {t: 'model', model: ev.model});
        break;

      case 'run_end': {
        const result = ev.result || {};
        if (result.nextState && result.nextState.sessionId) ctx.sessionId = result.nextState.sessionId;
        if (result.finalText && !ctx.assistant.text) ctx.assistant.text = result.finalText;
        if (result.usage) ctx.assistant.usage = result.usage;
        break;
      }

      case 'run_error':
        ctx.assistant.error = ev.message || ev.error || 'The run failed.';
        sendEvent(ctx.res, {t: 'error', message: ctx.assistant.error});
        break;

      default:
        break;
    }
    return;
  }

  if (frame.type === 'result') {
    if (frame.sessionId) ctx.sessionId = frame.sessionId;
    if (frame.subtype === 'error') {
      ctx.assistant.error = frame.error || 'Command Code reported an error.';
    }
    if (frame.finalText && !ctx.assistant.text) ctx.assistant.text = frame.finalText;
    if (frame.usage) ctx.assistant.usage = frame.usage;
    ctx.exitSubtype = frame.subtype;
  }
}

async function startTurn(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return json(res, 400, {error: `Bad request: ${err.message}`});
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json(res, 400, {error: 'Message is empty.'});
  if (text.length > 40000) return json(res, 400, {error: 'Message is over 40,000 characters.'});

  const mode = body.mode === 'full' ? 'full' : 'read-only';

  let conv = body.conversationId ? findConversation(body.conversationId) : null;
  if (!conv) {
    conv = makeConversation({
      title: text.replace(/\s+/g, ' ').slice(0, 60),
      workspace: workspaceFromInput(body.workspace) || WORKSPACE,
    });
  }
  if (running.has(conv.id)) return json(res, 409, {error: 'This conversation is still running.'});

  conv.updatedAt = Date.now();
  if (!conv.title || conv.title === 'New conversation') {
    conv.title = text.replace(/\s+/g, ' ').slice(0, 60);
  }
  persist();

  const args = ['-p', '--output-format', 'json', '--max-turns', MAX_TURNS, '--skip-onboarding'];
  if (conv.sessionId) args.push('--resume', conv.sessionId);
  if (mode === 'full') args.push('--yolo');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const assistant = {role: 'assistant', text: '', tools: [], ts: Date.now()};
  const ctx = {res, assistant, sessionId: conv.sessionId, exitSubtype: null};

  sendEvent(res, {t: 'start', conversationId: conv.id, mode, workspace: conv.workspace});

  const child = spawnCmdc(args, conv.workspace);
  running.set(conv.id, {child, assistant, wasStopped: false});

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 15000);

  let stdoutBuffer = '';
  let stderrTail = '';
  let finished = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      handleFrame(frame, ctx);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  child.stdin.on('error', () => {
    /* the CLI may close stdin early; nothing to do */
  });
  child.stdin.end(text);

  const finish = (code, signal) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);

    const record = running.get(conv.id);
    running.delete(conv.id);

    if (ctx.sessionId) conv.sessionId = ctx.sessionId;
    if (!assistant.text && !assistant.error) {
      assistant.text = code === 0 ? '' : `The run ended with code ${code}${signal ? ` (${signal})` : ''}.`;
      if (code !== 0 && stderrTail.trim()) assistant.error = stderrTail.trim().slice(-800);
    }
    if (record && record.wasStopped) assistant.stopped = true;

    conv.updatedAt = Date.now();
    conv.lastTurnAt = Date.now();
    persist();
    invalidateSessionIndex();

    sendEvent(res, {
      t: 'done',
      conversationId: conv.id,
      sessionId: conv.sessionId || null,
      text: assistant.text,
      tools: assistant.tools,
      usage: assistant.usage || null,
      stopped: Boolean(assistant.stopped),
      error: assistant.error || null,
      exitCode: code,
    });
    if (!res.writableEnded) res.end();
  };

  child.on('error', (err) => {
    assistant.error = `Could not start Command Code: ${err.message}`;
    sendEvent(res, {t: 'error', message: assistant.error});
    finish(1, null);
  });

  child.on('close', (code, signal) => finish(code, signal));

  req.on('close', () => {
    // The phone dropped the stream. The run continues; the window just stops receiving frames.
    clearInterval(heartbeat);
  });
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const STATIC = {
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/login.js': ['public/login.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
};

function serveStatic(res, relPath, type, status = 200) {
  try {
    const body = fs.readFileSync(path.join(HERE, relPath));
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(`Could not read ${relPath}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, {ok: true, version: VERSION, workspace: WORKSPACE, running: running.size});
    }

    if (req.method === 'GET' && pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && (pathname === '/login' || pathname === '/login.html')) {
      if (isAuthed(req)) {
        res.writeHead(302, {Location: '/'});
        return res.end();
      }
      return serveStatic(res, 'public/login.html', 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      if (!loginAllowed(ip)) return json(res, 429, {error: 'Too many attempts. Wait ten minutes.'});
      const body = await readJson(req);
      const supplied = typeof body.password === 'string' ? body.password : '';
      const a = Buffer.from(supplied);
      const b = Buffer.from(PASSWORD);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) {
        noteLoginFailure(ip);
        return json(res, 401, {error: 'Wrong password.'});
      }
      passwordAttempts.delete(ip);
      const trust = body.trust !== false;
      const cookie = [`${COOKIE_NAME}=${SESSION_TOKEN}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
      if (trust) cookie.push(`Max-Age=${60 * 60 * 24 * 30}`);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookie.join('; '),
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify({ok: true}));
    }

    if (pathname.startsWith('/api/') || pathname === '/') {
      if (!isAuthed(req)) {
        if (pathname === '/') {
          res.writeHead(302, {Location: '/login'});
          return res.end();
        }
        return json(res, 401, {error: 'Not signed in.'});
      }
    }

    if (req.method === 'GET' && pathname === '/') {
      return serveStatic(res, 'public/index.html', 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && STATIC[pathname]) {
      return serveStatic(res, STATIC[pathname][0], STATIC[pathname][1]);
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      });
      return res.end(JSON.stringify({ok: true}));
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      return json(res, 200, {
        workspace: WORKSPACE,
        workspaces: state.workspaces,
        host: process.env.THECHAMBERS_HOST || null,
        port: PORT,
        cliEntry: CLI_ENTRY,
        running: [...running.keys()],
        conversations: state.conversations.map(publicConversation),
      });
    }

    // Projects are the working directories Command Code already has sessions for, plus any
    // folder added by hand. This is the phone-friendly version of a folder picker.
    if (req.method === 'GET' && pathname === '/api/projects') {
      const seen = new Map();
      for (const item of sessionIndex().values()) {
        const key = normalisePath(item.cwd);
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, {path: item.cwd, lastUsed: item.updatedAt, sessions: 1});
        } else {
          existing.sessions += 1;
          existing.lastUsed = Math.max(existing.lastUsed, item.updatedAt);
        }
      }
      for (const workspace of state.workspaces) {
        const key = normalisePath(workspace);
        if (!seen.has(key)) seen.set(key, {path: workspace, lastUsed: 0, sessions: 0});
      }
      const currentKey = normalisePath(WORKSPACE);
      if (!seen.has(currentKey)) {
        seen.set(currentKey, {path: WORKSPACE, lastUsed: Date.now(), sessions: 0});
      }
      const projects = [...seen.values()]
        .map((project) => ({...project, name: path.basename(project.path) || project.path}))
        .sort((a, b) => b.lastUsed - a.lastUsed);
      return json(res, 200, {projects, current: WORKSPACE});
    }

    if (req.method === 'POST' && pathname === '/api/workspaces') {
      const body = await readJson(req).catch(() => ({}));
      const workspace = workspaceFromInput(body.path);
      if (!workspace) return json(res, 400, {error: 'That path is not a folder on this machine.'});
      if (!state.workspaces.some((item) => normalisePath(item) === normalisePath(workspace))) {
        state.workspaces.unshift(workspace);
        state.workspaces = state.workspaces.slice(0, 30);
        persist();
      }
      return json(res, 200, {path: workspace});
    }

    // The sessions on disk, so work started in a terminal is visible here too.
    if (req.method === 'GET' && pathname === '/api/sessions') {
      const workspace = url.searchParams.get('workspace');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 60, 200);
      const sessions = sessionsFor(workspace)
        .slice(0, limit)
        .map((item) => ({
          id: item.id,
          title: item.title || '',
          cwd: item.cwd,
          model: item.model,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          // Written to within the last couple of minutes: most likely an open terminal session.
          active: Date.now() - item.updatedAt < LIVE_WINDOW_MS,
        }));
      return json(res, 200, {sessions});
    }

    if (req.method === 'POST' && pathname === '/api/sessions/resume') {
      const body = await readJson(req).catch(() => ({}));
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const item = sessionIndex().get(sessionId);
      if (!item) return json(res, 404, {error: 'That session is not on this machine.'});

      const existing = findConversationBySession(sessionId);
      if (existing) return json(res, 200, publicConversation(existing));

      const fallbackTitle = latestUserText(sessionId).replace(/\s+/g, ' ').slice(0, 60);
      const conv = makeConversation({
        title: item.title || fallbackTitle || 'Resumed session',
        workspace: item.cwd,
        sessionId,
      });
      // Treat everything already on disk as seen; only later writes are "external".
      conv.lastTurnAt = item.updatedAt;
      persist();
      return json(res, 201, publicConversation(conv));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/conversations/')) {
      const id = pathname.slice('/api/conversations/'.length);
      const conv = findConversation(id);
      if (!conv) return json(res, 404, {error: 'No such conversation.'});
      const messages = transcriptMessages(conv.sessionId);
      const item = conv.sessionId ? sessionIndex().get(conv.sessionId) : null;
      // A write landed after our last turn finished, so something else (a terminal, or another
      // device) is driving this session too.
      const externalActive = Boolean(
        item && conv.lastTurnAt && item.updatedAt > conv.lastTurnAt + 2000,
      );
      return json(res, 200, {
        ...publicConversation(conv),
        messages,
        messageCount: messages.length,
        sessionUpdatedAt: item ? item.updatedAt : null,
        externalActive,
      });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/conversations/')) {
      const id = pathname.slice('/api/conversations/'.length);
      const record = running.get(id);
      if (record) {
        record.wasStopped = true;
        stopChild(record.child);
      }
      const before = state.conversations.length;
      state.conversations = state.conversations.filter((conv) => conv.id !== id);
      if (state.conversations.length === before) return json(res, 404, {error: 'No such conversation.'});
      persist();
      return json(res, 200, {ok: true});
    }

    if (req.method === 'POST' && pathname === '/api/conversations') {
      const body = await readJson(req).catch(() => ({}));
      const conv = makeConversation({
        title: typeof body.title === 'string' ? body.title.slice(0, 80) : 'New conversation',
        workspace: workspaceFromInput(body.workspace) || WORKSPACE,
      });
      return json(res, 201, publicConversation(conv));
    }

    if (req.method === 'POST' && pathname === '/api/turn') {
      const origin = req.headers.origin;
      let sameOrigin = true;
      try {
        sameOrigin = !origin || new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) return json(res, 403, {error: 'Cross-origin request refused.'});
      return await startTurn(req, res);
    }

    if (req.method === 'POST' && pathname === '/api/stop') {
      const body = await readJson(req).catch(() => ({}));
      const record = body.conversationId ? running.get(body.conversationId) : null;
      if (!record) return json(res, 404, {error: 'Nothing is running.'});
      record.wasStopped = true;
      stopChild(record.child);
      return json(res, 200, {ok: true});
    }

    res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({error: 'Not found.'}));
  } catch (err) {
    console.error('[thechambers] request failed', err);
    if (!res.headersSent) {
      json(res, 500, {error: err.message});
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

function resolveHost() {
  if (process.env.THECHAMBERS_HOST) return process.env.THECHAMBERS_HOST;
  try {
    const out = execFileSync('tailscale', ['ip', '-4'], {encoding: 'utf8', timeout: 5000});
    const ip = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
    if (ip) return ip;
  } catch {
    /* Tailscale not installed or not up; fall through to loopback. */
  }
  return '127.0.0.1';
}

const HOST = resolveHost();
const servers = [];

// One listener on the Tailscale address (the phone) and, when that is not loopback, a second
// on 127.0.0.1 so this desktop can use the same app at the same port. Neither listener is
// reachable from the local network.
const addListener = (host) => {
  const instance = http.createServer(handler);
  instance.listen(PORT, host, () => {
    console.log(`[thechambers] listening on http://${host}:${PORT}`);
  });
  servers.push(instance);
};

addListener(HOST);
if (HOST !== '127.0.0.1') addListener('127.0.0.1');

console.log(`[thechambers] workspace: ${WORKSPACE}`);
console.log(`[thechambers] password:  ${PASSWORD_FILE}`);
console.log(`[thechambers] cli:       ${CLI_ENTRY || 'cmdc (PATH)'}`);
if (HOST === '127.0.0.1') {
  console.log('[thechambers] Bound to loopback only - the phone will not reach this.');
}

function shutdown() {
  for (const record of running.values()) stopChild(record.child);
  let pending = servers.length;
  for (const instance of servers) {
    instance.close(() => {
      pending -= 1;
      if (pending === 0) process.exit(0);
    });
  }
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
