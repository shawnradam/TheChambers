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
import {spawn, execFile, execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), '.config', 'thechambers');
const PASSWORD_FILE = path.join(CONFIG_DIR, 'ui-password.txt');
const SECRET_FILE = path.join(CONFIG_DIR, 'secret.txt');
const CONVERSATIONS_FILE = path.join(CONFIG_DIR, 'conversations.json');
const NOTES_FILE = path.join(CONFIG_DIR, 'notes.json');
const UPLOAD_DIR = path.join(CONFIG_DIR, 'uploads');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

const env = (name, legacy, fallback) => process.env[name] || (legacy ? process.env[legacy] : undefined) || fallback;

const PORT = Number(env('THECHAMBERS_PORT', 'CMDC_WEB_PORT', 3002));
const WORKSPACE = path.resolve(env('THECHAMBERS_WORKSPACE', 'CMDC_WEB_WORKSPACE', os.homedir()));
const MAX_TURNS = String(env('THECHAMBERS_MAX_TURNS', 'CMDC_WEB_MAX_TURNS', 60));
const VERSION = '1.2.0';
// Where updates come from. A fork can point this somewhere else without editing code.
const REPO = env('THECHAMBERS_REPO', null, 'shawnradam/TheChambers');
// A session touched this recently is almost certainly still open in a terminal.
const LIVE_WINDOW_MS = 120000;

fs.mkdirSync(CONFIG_DIR, {recursive: true});
fs.mkdirSync(UPLOAD_DIR, {recursive: true});

// A log the launcher window cannot show: the server often runs hidden, and a crash there used to
// leave the phone with a bare "network error" and nothing to read.
const LOG_FILE = path.join(CONFIG_DIR, 'server.log');

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    const size = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    if (size > 1024 * 1024) fs.writeFileSync(LOG_FILE, line);
    else fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* logging must never break a request */
  }
}

process.on('uncaughtException', (err) => {
  logLine(`uncaught: ${err && err.stack ? err.stack : err}`);
  console.error('[thechambers] uncaught exception', err);
});

process.on('unhandledRejection', (err) => {
  logLine(`unhandled rejection: ${err && err.stack ? err.stack : err}`);
});

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
// The cookie is derived from the secret *and* the current password, so rotating the password
// invalidates every device at once — the behaviour the README promises. Replacing secret.txt
// additionally revokes everything without touching the password.
const SESSION_TOKEN = crypto
  .createHmac('sha256', SECRET)
  .update(`thechambers-session-v1:${PASSWORD}`)
  .digest('hex');
const COOKIE_NAME = 'thechambers';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {conversations: [], workspaces: [], notes: []};
try {
  if (fs.existsSync(CONVERSATIONS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
    if (Array.isArray(parsed.conversations)) {
      state = {
        conversations: parsed.conversations,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
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
// Settings and updates
//
// Updates come from the public GitHub repository. `git ls-remote` reads the remote head without
// fetching or authenticating, so a phone on the tailnet can ask "is there a newer commit" without
// holding any credentials. Applying is a fast-forward pull, and it refuses to run over a dirty
// tree: local work is never discarded to make room for an update.
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  autoCheckUpdates: true,
  autoUpdate: false,
  lastCheckAt: 0,
  lastKnownRemote: null,
};

let settings = {...DEFAULT_SETTINGS};
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') settings = {...DEFAULT_SETTINGS, ...parsed};
  }
} catch (err) {
  console.error(`[thechambers] Ignoring unreadable ${SETTINGS_FILE}: ${err.message}`);
}

function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error(`[thechambers] Could not save settings: ${err.message}`);
  }
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: HERE,
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    windowsHide: true,
    env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || '').trim(),
    err: (result.stderr || '').trim(),
    status: result.status,
  };
}

function repoState() {
  if (!fs.existsSync(path.join(HERE, '.git'))) {
    return {isGit: false, commit: null, short: null, branch: null, dirty: false, remote: REPO};
  }
  const commit = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return {
    isGit: commit.ok,
    commit: commit.ok ? commit.out : null,
    short: commit.ok ? commit.out.slice(0, 7) : null,
    branch: branch.ok ? branch.out : null,
    dirty: status.ok ? status.out.length > 0 : false,
    remote: REPO,
  };
}

// Anonymous read of the remote head. No fetch, no credentials, no API rate limit.
function remoteHead(branch) {
  const result = git(['ls-remote', `https://github.com/${REPO}.git`, `refs/heads/${branch}`], {
    timeout: 20000,
  });
  if (!result.ok) return {ok: false, error: result.err || 'Could not reach GitHub.'};
  const sha = result.out.split(/\s+/)[0];
  return sha ? {ok: true, commit: sha} : {ok: false, error: 'GitHub returned no commit for that branch.'};
}

let updateCache = {at: 0, value: null};

function updateStatus({force = false} = {}) {
  if (!force && updateCache.value && Date.now() - updateCache.at < 60000) return updateCache.value;

  const local = repoState();
  if (!local.isGit) {
    const value = {
      ok: true,
      isGit: false,
      repo: REPO,
      current: {version: VERSION, commit: null, short: null, branch: null, dirty: false},
      latest: null,
      updateAvailable: false,
      note: 'This folder is not a git checkout, so updates cannot be pulled. Clone the repository to enable them.',
    };
    updateCache = {at: Date.now(), value};
    return value;
  }

  const branch = local.branch || 'main';
  const remote = remoteHead(branch);
  const latest = remote.ok
    ? {
        commit: remote.commit,
        short: remote.commit.slice(0, 7),
        // GitHub's compare page is a click away from the diff.
        url: `https://github.com/${REPO}/compare/${local.commit || 'HEAD'}...${remote.commit}`,
      }
    : null;

  // A local commit ahead of origin is not an update. Only offer one when the remote head is
  // not already an ancestor of HEAD.
  const remoteKnown = Boolean(latest && local.commit);
  const remoteIsAncestor = remoteKnown
    ? git(['merge-base', '--is-ancestor', latest.commit, 'HEAD']).status === 0
    : false;
  const updateAvailable = Boolean(remoteKnown && latest.commit !== local.commit && !remoteIsAncestor);
  settings.lastCheckAt = Date.now();
  if (latest) settings.lastKnownRemote = latest.commit;
  persistSettings();

  const value = {
    ok: true,
    isGit: true,
    repo: REPO,
    branch,
    current: {
      version: VERSION,
      commit: local.commit,
      short: local.short,
      dirty: local.dirty,
    },
    latest,
    updateAvailable,
    error: remote.ok ? null : remote.error,
    canApply: Boolean(updateAvailable) && !local.dirty,
  };
  updateCache = {at: Date.now(), value};
  return value;
}

function applyUpdate() {
  const local = repoState();
  if (!local.isGit) return {ok: false, error: 'This folder is not a git checkout.'};
  if (local.dirty) {
    return {
      ok: false,
      error: 'Local changes are uncommitted. Commit or stash them first — the update will not overwrite your work.',
      dirty: true,
    };
  }

  const branch = local.branch || 'main';
  const fetch = git(['fetch', '--quiet', 'origin', branch], {timeout: 60000});
  if (!fetch.ok) return {ok: false, error: fetch.err || 'git fetch failed.'};

  const pull = git(['merge', '--ff-only', `origin/${branch}`], {timeout: 60000});
  if (!pull.ok) return {ok: false, error: pull.err || pull.out || 'Fast-forward failed.'};

  const after = repoState();
  updateCache = {at: 0, value: null};
  // Server code changed? The files on disk are new, but this process is still running the old ones.
  const restartRequired = git(['diff', '--name-only', 'HEAD@{1}', 'HEAD']).out
    .split('\n')
    .some((file) => file === 'server.mjs' || file.startsWith('tools/'));

  return {
    ok: true,
    from: local.commit,
    to: after.commit,
    dirty: after.dirty,
    restartRequired,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Uploads
//
// Screenshots and files pasted on the phone are written to disk and handed to the agent by
// path — Command Code reads files with its own tools, so nothing needs to be inlined into the
// prompt. Previews are served back from here, authenticated like every other API call.
// ---------------------------------------------------------------------------

const UPLOAD_LIMIT = 12 * 1024 * 1024;
const UPLOAD_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function safeUploadName(name) {
  const base = path.basename(String(name || 'file'))
    .replace(/[^\w.\- ]+/g, '_')
    .slice(-80);
  return base || 'file';
}

// Keep the newest 200 uploads; they are scratch, not an archive.
function pruneUploads() {
  try {
    const entries = fs
      .readdirSync(UPLOAD_DIR)
      .map((name) => {
        const full = path.join(UPLOAD_DIR, name);
        try {
          return {full, mtime: fs.statSync(full).mtimeMs};
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(200)) {
      try {
        fs.unlinkSync(entry.full);
      } catch {
        /* nothing to do */
      }
    }
  } catch {
    /* an unreadable upload dir is not worth failing a request over */
  }
}

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
// Where the Command Code CLI lives. npm's layout differs per platform, so ask npm first and keep
// a list of known prefixes as a fallback: Homebrew on Apple silicon, Intel Macs, npm's own
// user-level prefix, nvm, Volta, and the Windows roaming prefix.
function npmGlobalRoot() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    return execFileSync(npm, ['root', '-g'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return null;
  }
}

function resolveCliEntry() {
  if (process.env.CMDC_ENTRY) return process.env.CMDC_ENTRY;

  const suffixes = [
    path.join('command-code', 'dist', 'index.mjs'),
    path.join('@commandcode', 'cli', 'dist', 'index.mjs'),
  ];
  const roots = new Set();
  const globalRoot = npmGlobalRoot();
  if (globalRoot) roots.add(globalRoot);
  roots.add(path.join(process.env.APPDATA || '', 'npm', 'node_modules'));
  roots.add(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'));
  roots.add('/opt/homebrew/lib/node_modules');
  roots.add('/usr/local/lib/node_modules');
  roots.add('/usr/lib/node_modules');
  roots.add(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'));
  roots.add(path.join(os.homedir(), '.volta', 'tools', 'image', 'packages'));

  for (const root of roots) {
    if (!root) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(root, suffix);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // nvm keeps one tree per Node version; take the newest that has the CLI.
  try {
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    for (const version of fs.readdirSync(nvm).sort().reverse()) {
      const candidate = path.join(nvm, version, 'lib', 'node_modules', 'command-code', 'dist', 'index.mjs');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* no nvm */
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
    model: conv.model || null,
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

function workspaceOr(value) {
  return workspaceFromInput(value) || WORKSPACE;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Small promise wrapper around execFile with a hard timeout and output cap. The panels
// (Git, Files, Terminal) all use it, so they share one place where output can be bounded.
function runProcess(file, args, {cwd, timeout = 15000, max = 262144} = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {cwd, timeout, maxBuffer: max, windowsHide: true, encoding: 'utf8'},
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          signal: error && error.signal ? error.signal : null,
          stdout: stdout || '',
          stderr: stderr || '',
          error: error && !stdout && !stderr ? error.message : null,
        });
      },
    );
  });
}

let modelsCache = null;
let modelsAt = 0;

function parseModels(text) {
  const groups = [];
  let group = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^(Available models|Pass the full id|cmdc |Docs:|Decision models)/.test(line)) continue;

    // Model rows are `id  description` at column 0. Group headers are a bare word at column 0.
    const match = line.match(/^(\S+)\s{2,}(.+)$/);
    if (match) {
      if (!group) {
        group = {name: 'Models', models: []};
        groups.push(group);
      }
      const isDefault = /\(default\)/.test(match[2]);
      group.models.push({
        id: match[1],
        note: match[2].replace(/\s*\(default\)\s*/, '').trim(),
        default: isDefault,
      });
      continue;
    }

    if (/^\S/.test(line) && !/^["']/.test(line)) {
      const name = line.trim();
      if (name.length > 40) continue;
      group = {name, models: []};
      groups.push(group);
    }
  }
  return groups.filter((item) => item.models.length);
}

async function listModels() {
  if (modelsCache && Date.now() - modelsAt < 6 * 60 * 60 * 1000) return modelsCache;
  const file = CLI_ENTRY ? process.execPath : process.platform === 'win32' ? 'cmdc.cmd' : 'cmdc';
  const args = CLI_ENTRY ? [CLI_ENTRY, '--list-models'] : ['--list-models'];
  const result = await runProcess(file, args, {timeout: 20000});
  const text = result.stdout || result.stderr;
  const groups = parseModels(text);
  const flat = groups.flatMap((group) => group.models);
  modelsCache = {
    groups,
    defaultModel: (flat.find((model) => model.default) || flat[0] || {}).id || null,
  };
  modelsAt = Date.now();
  return modelsCache;
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

  const mode =
    body.mode === 'full' ? 'full' : body.mode === 'plan' ? 'plan' : body.mode === 'accept' ? 'accept' : 'read-only';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : null;
  const effort = typeof body.effort === 'string' && body.effort.trim() ? body.effort.trim().slice(0, 20) : null;

  let conv = body.conversationId ? findConversation(body.conversationId) : null;
  if (!conv) {
    conv = makeConversation({
      title: text.replace(/\s+/g, ' ').slice(0, 60),
      workspace: workspaceFromInput(body.workspace) || WORKSPACE,
    });
  }
  if (running.has(conv.id)) return json(res, 409, {error: 'This conversation is still running.'});

  conv.updatedAt = Date.now();
  if (model) conv.model = model;
  if (!conv.title || conv.title === 'New conversation') {
    conv.title = text.replace(/\s+/g, ' ').slice(0, 60);
  }
  persist();

  const args = ['-p', '--output-format', 'json', '--max-turns', MAX_TURNS, '--skip-onboarding'];
  if (conv.sessionId) args.push('--resume', conv.sessionId);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (mode === 'full') args.push('--yolo');
  if (mode === 'accept') args.push('--accept-edits');
  if (mode === 'plan') args.push('--plan');

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

  // Watch the *response*, not the request. An IncomingMessage emits 'close' as soon as its body
  // has been consumed, which is immediately for our small JSON POST — clearing the heartbeat
  // there left a long turn with no bytes on the wire, and phone networks drop those silently.
  // The run itself keeps going either way; only the pipe to this browser is affected.
  res.on('close', () => {
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
  '/logo-32.png': ['public/logo-32.png', 'image/png'],
  '/logo-64.png': ['public/logo-64.png', 'image/png'],
  '/logo-192.png': ['public/logo-192.png', 'image/png'],
  '/logo-512.png': ['public/logo-512.png', 'image/png'],
  '/apple-touch-icon.png': ['public/apple-touch-icon.png', 'image/png'],
  '/favicon.ico': ['public/logo-32.png', 'image/png'],
  '/site.webmanifest': ['public/site.webmanifest', 'application/manifest+json; charset=utf-8'],
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src http: https:; base-uri 'none'; form-action 'none'",
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
      const repo = repoState();
      return json(res, 200, {
        ok: true,
        version: VERSION,
        commit: repo.short,
        host: HOST,
        workspace: WORKSPACE,
        running: running.size,
      });
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

    // Defence in depth for every state-changing call, not just /api/turn and /api/exec: a
    // same-site cookie already keeps cross-site POSTs out, but an explicit origin check means a
    // browser-side mistake cannot turn into a write. Requests without an Origin (curl, scripts)
    // are still allowed because they carry no ambient cookie.
    if (req.method !== 'GET' && req.method !== 'HEAD' && pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(origin).host === req.headers.host;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) return json(res, 403, {error: 'Cross-origin request refused.'});
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

    if (req.method === 'GET' && pathname === '/api/update') {
      const force = url.searchParams.get('force') === '1';
      return json(res, 200, updateStatus({force}));
    }

    if (req.method === 'POST' && pathname === '/api/update/apply') {
      const result = applyUpdate();
      if (!result.ok) return json(res, result.dirty ? 409 : 500, result);
      // A pull changed files on disk. The running process keeps the old server code in memory,
      // but the browser only needs a reload for the static files.
      return json(res, 200, {...result, current: repoState()});
    }

    if (req.method === 'GET' && pathname === '/api/settings') {
      const repo = repoState();
      return json(res, 200, {
        ...settings,
        version: VERSION,
        commit: repo.short,
        repo: REPO,
        // Prove the update path is usable before offering the button.
        updatesSupported: repo.isGit,
      });
    }

    if (req.method === 'POST' && pathname === '/api/settings') {
      const body = await readJson(req).catch(() => ({}));
      for (const key of ['autoCheckUpdates', 'autoUpdate']) {
        if (typeof body[key] === 'boolean') settings[key] = body[key];
      }
      persistSettings();
      return json(res, 200, settings);
    }

    // A pasted screenshot arrives as base64 JSON: no multipart parser, no dependencies.
    if (req.method === 'POST' && pathname === '/api/uploads') {
      const body = await readJson(req, UPLOAD_LIMIT + 1024 * 1024).catch(() => null);
      if (!body || typeof body.data !== 'string') {
        return json(res, 400, {error: 'Expected {name, data} with base64 data.'});
      }
      const encoded = body.data.replace(/^data:[^;]+;base64,/, '');
      let buffer;
      try {
        buffer = Buffer.from(encoded, 'base64');
      } catch {
        return json(res, 400, {error: 'That attachment is not valid base64.'});
      }
      if (!buffer.length) return json(res, 400, {error: 'The attachment is empty.'});
      if (buffer.length > UPLOAD_LIMIT) {
        return json(res, 413, {error: 'Attachments are limited to 12 MB.'});
      }

      const name = safeUploadName(body.name);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = `${stamp}-${name}`;
      const full = path.join(UPLOAD_DIR, file);
      fs.writeFileSync(full, buffer);
      pruneUploads();

      return json(res, 201, {
        ok: true,
        name,
        size: buffer.length,
        path: full,
        url: `/api/uploads/${encodeURIComponent(file)}`,
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/uploads/')) {
      const name = path.basename(decodeURIComponent(pathname.slice('/api/uploads/'.length)));
      const full = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(full)) return json(res, 404, {error: 'No such upload.'});
      const type = UPLOAD_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
      const data = fs.readFileSync(full);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      });
      return res.end(data);
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
        item && conv.lastTurnAt && item.updatedAt > conv.lastTurnAt + 800,
      );
      return json(res, 200, {
        ...publicConversation(conv),
        messages,
        messageCount: messages.length,
        sessionUpdatedAt: item ? item.updatedAt : null,
        externalActive,
      });
    }

    if (req.method === 'PATCH' && pathname.startsWith('/api/conversations/')) {
      const id = pathname.slice('/api/conversations/'.length);
      const conv = findConversation(id);
      if (!conv) return json(res, 404, {error: 'No such conversation.'});
      const body = await readJson(req).catch(() => ({}));
      if (typeof body.title === 'string' && body.title.trim()) {
        conv.title = body.title.trim().slice(0, 100);
        conv.updatedAt = Date.now();
        persist();
      }
      return json(res, 200, publicConversation(conv));
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

    // -----------------------------------------------------------------------
    // Workspace surfaces: files, search, git, terminal, notes, models
    // -----------------------------------------------------------------------

    if (req.method === 'GET' && pathname === '/api/files') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      const target = path.resolve(workspace, url.searchParams.get('path') || '');
      if (!isInside(workspace, target)) {
        return json(res, 400, {error: 'That path is outside the project.'});
      }
      let entries;
      try {
        entries = fs
          .readdirSync(target, {withFileTypes: true})
          .filter((entry) => entry.name !== '.git' && entry.name !== 'node_modules')
          .map((entry) => {
            const full = path.join(target, entry.name);
            let size = 0;
            let mtime = 0;
            try {
              const stat = fs.statSync(full);
              size = stat.size;
              mtime = stat.mtimeMs;
            } catch {
              /* a broken symlink still shows, just without size */
            }
            return {name: entry.name, path: full, dir: entry.isDirectory(), size, mtime};
          })
          .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      } catch {
        return json(res, 404, {error: 'Cannot read that folder.'});
      }
      return json(res, 200, {workspace, path: target, entries});
    }

    if (req.method === 'GET' && pathname === '/api/search') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);
      if (!query) return json(res, 200, {entries: []});
      const entries = [];
      const walk = (dir, depth) => {
        if (entries.length >= 200 || depth > 8) return;
        let list = [];
        try {
          list = fs.readdirSync(dir, {withFileTypes: true});
        } catch {
          return;
        }
        for (const entry of list) {
          if (entries.length >= 200) return;
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (entry.name.toLowerCase().includes(query)) entries.push({name: entry.name, path: full, dir: false});
        }
      };
      walk(workspace, 0);
      return json(res, 200, {entries});
    }

    if (req.method === 'GET' && pathname === '/api/file') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      const target = path.resolve(workspace, url.searchParams.get('path') || '');
      if (!isInside(workspace, target)) return json(res, 400, {error: 'That path is outside the project.'});
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) return json(res, 400, {error: 'That is not a file.'});
        const cap = 512 * 1024;
        const start = Math.max(0, stat.size - cap);
        const fd = fs.openSync(target, 'r');
        const buffer = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        fs.closeSync(fd);
        const binary = buffer.includes(0);
        return json(res, 200, {
          path: target,
          size: stat.size,
          binary,
          truncated: start > 0,
          text: binary ? null : buffer.toString('utf8'),
        });
      } catch {
        return json(res, 404, {error: 'Cannot read that file.'});
      }
    }

    if (req.method === 'GET' && pathname === '/api/git') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      if (!fs.existsSync(path.join(workspace, '.git'))) {
        return json(res, 200, {isRepo: false, workspace});
      }
      const branch = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: workspace});
      const status = await runProcess('git', ['status', '--porcelain=v1', '-z'], {cwd: workspace});
      const parts = status.stdout.split('\0').filter(Boolean);
      const files = [];
      for (let i = 0; i < parts.length; i += 1) {
        const entry = parts[i];
        if (entry.length < 4) continue;
        const code = entry.slice(0, 2).trim() || '?';
        files.push({status: code, path: entry.slice(3)});
        if (code.startsWith('R') || code.startsWith('C')) i += 1;
      }
      return json(res, 200, {
        isRepo: true,
        workspace,
        branch: branch.ok ? branch.stdout.trim() : '',
        files,
        clean: files.length === 0,
      });
    }

    if (req.method === 'POST' && pathname === '/api/git/init') {
      const body = await readJson(req).catch(() => ({}));
      const workspace = workspaceOr(body.workspace);
      const result = await runProcess('git', ['init'], {cwd: workspace});
      return json(res, result.ok ? 200 : 500, {
        ok: result.ok,
        output: `${result.stdout}${result.stderr}`.trim(),
      });
    }

    if (req.method === 'GET' && pathname === '/api/diff') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      const file = url.searchParams.get('path') || '';
      const target = file ? path.resolve(workspace, file) : null;
      if (target && !isInside(workspace, target)) return json(res, 400, {error: 'Outside the project.'});
      const args = ['diff', '--no-color'];
      if (file) args.push('--', file);
      const result = await runProcess('git', args, {cwd: workspace, max: 1024 * 1024});
      let diff = result.stdout || '';
      // An untracked file has no diff; show its contents as an addition instead.
      if (!diff && target && fs.existsSync(target) && fs.statSync(target).isFile()) {
        const text = fs.readFileSync(target, 'utf8');
        diff = text
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n');
      }
      return json(res, 200, {path: file || null, diff});
    }

    if (req.method === 'GET' && pathname === '/api/walkthrough') {
      const workspace = workspaceOr(url.searchParams.get('workspace'));
      const result = await runProcess(
        'git',
        ['log', '--no-color', '--date=short', '--pretty=format:%h%x09%ad%x09%s', '-n', '30'],
        {cwd: workspace},
      );
      const commits = result.ok
        ? result.stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const [hash, date, ...rest] = line.split('\t');
              return {hash, date, subject: rest.join('\t')};
            })
        : [];
      return json(res, 200, {isRepo: Boolean(commits.length), commits});
    }

    if (req.method === 'POST' && pathname === '/api/exec') {
      const origin = req.headers.origin;
      try {
        if (origin && new URL(origin).host !== req.headers.host) {
          return json(res, 403, {error: 'Cross-origin request refused.'});
        }
      } catch {
        return json(res, 403, {error: 'Cross-origin request refused.'});
      }
      const body = await readJson(req).catch(() => ({}));
      const command = typeof body.command === 'string' ? body.command.trim() : '';
      if (!command) return json(res, 400, {error: 'No command.'});
      if (command.length > 4000) return json(res, 400, {error: 'Command is too long.'});
      const workspace = workspaceOr(body.workspace);
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const args =
        process.platform === 'win32'
          ? ['-NoProfile', '-NonInteractive', '-Command', command]
          : ['-lc', command];
      const started = Date.now();
      const result = await runProcess(shell, args, {cwd: workspace, timeout: 120000, max: 512 * 1024});
      return json(res, 200, {
        output: `${result.stdout}${result.stderr}`.slice(-200000),
        code: result.code,
        ok: result.ok,
        ms: Date.now() - started,
      });
    }

    if (pathname === '/api/notes') {
      if (req.method === 'GET') {
        const workspace = workspaceOr(url.searchParams.get('workspace'));
        const wanted = normalisePath(workspace);
        const notes = state.notes.filter((note) => normalisePath(note.workspace) === wanted);
        return json(res, 200, {notes});
      }
      if (req.method === 'POST') {
        const body = await readJson(req).catch(() => ({}));
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
        if (!text) return json(res, 400, {error: 'Write something first.'});
        const tab = ['notes', 'todo', 'plans'].includes(body.tab) ? body.tab : 'notes';
        const note = {
          id: crypto.randomUUID(),
          workspace: workspaceOr(body.workspace),
          tab,
          text,
          done: false,
          createdAt: Date.now(),
        };
        state.notes.unshift(note);
        persist();
        return json(res, 201, note);
      }
    }

    if (pathname.startsWith('/api/notes/')) {
      const id = pathname.slice('/api/notes/'.length);
      const note = state.notes.find((item) => item.id === id);
      if (!note) return json(res, 404, {error: 'No such note.'});
      if (req.method === 'PATCH') {
        const body = await readJson(req).catch(() => ({}));
        if (typeof body.text === 'string') note.text = body.text.trim().slice(0, 4000);
        if (typeof body.done === 'boolean') note.done = body.done;
        persist();
        return json(res, 200, note);
      }
      if (req.method === 'DELETE') {
        state.notes = state.notes.filter((item) => item.id !== id);
        persist();
        return json(res, 200, {ok: true});
      }
    }

    if (req.method === 'GET' && pathname === '/api/models') {
      try {
        return json(res, 200, await listModels());
      } catch (err) {
        return json(res, 200, {groups: [], defaultModel: null, error: err.message});
      }
    }

    res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({error: 'Not found.'}));
  } catch (err) {
    console.error('[thechambers] request failed', err);
    logLine(`request failed: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      json(res, 500, {error: err.message});
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

// Tailscale's CLI is on PATH on Windows and Linux; the macOS app bundle keeps it inside the
// .app, so try both spellings before giving up on the tailnet address.
const TAILSCALE_BINARIES = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
];

function tailscaleIp() {
  for (const binary of TAILSCALE_BINARIES) {
    try {
      const out = execFileSync(binary, ['ip', '-4'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const ip = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (ip) return ip;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

function resolveHost() {
  if (process.env.THECHAMBERS_HOST) return process.env.THECHAMBERS_HOST;
  return tailscaleIp() || '127.0.0.1';
}

const HOST = resolveHost();
const servers = [];

if (HOST !== '127.0.0.1' && HOST !== tailscaleIp()) {
  console.warn(
    `[thechambers] WARNING: bound to ${HOST}, which is not a Tailscale address. ` +
      'Traffic is not encrypted by Tailscale there, so the password crosses the network in the clear.',
  );
}

// One listener on the Tailscale address (the phone) and, when that is not loopback, a second
// on 127.0.0.1 so this desktop can use the same app at the same port. Neither listener is
// reachable from the local network.
const addListener = (host) => {
  const instance = http.createServer(handler);
  // A turn can run for many minutes. None of Node's defaults should be allowed to cut the pipe:
  // no request-receipt timeout, a generous header timeout, and no socket idle timeout.
  instance.requestTimeout = 0;
  instance.headersTimeout = 120000;
  instance.timeout = 0;
  instance.keepAliveTimeout = 65000;
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
