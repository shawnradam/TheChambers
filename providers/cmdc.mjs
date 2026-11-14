// Command Code adapter — the reference implementation of the provider contract.
// See providers/README.md. Nothing in here is imported by another adapter; a new agent gets its
// own file with the same shape.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';

const SESSIONS_ROOT = path.join(os.homedir(), '.commandcode', 'projects');

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

function resolveEntry() {
  if (process.env.CMDC_ENTRY) return process.env.CMDC_ENTRY;
  const suffixes = ['command-code/dist/index.mjs', '@commandcode/cli/dist/index.mjs'];
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

function normalisePath(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function summariseInput(input) {
  if (input === undefined || input === null) return '';
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return '';
  }
}

const headerCache = new Map();

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
    header = JSON.parse(buffer.subarray(0, bytes).toString('utf8').split('\n')[0]);
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

const transcriptCache = new Map();

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
      /* corrupt line: skip it */
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
          ? part.content.filter((piece) => piece.type === 'text').map((piece) => piece.text).join('\n')
          : typeof part.content === 'string'
            ? part.content
            : '';
        tool.result = result.slice(0, 4000);
        tool.status = 'done';
      }
      continue;
    }

    if (message.role === 'user') {
      const userText = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
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

export default {
  id: 'cmdc',
  label: 'Command Code',
  docs: 'https://commandcode.ai/docs',
  capabilities: {resume: true, transcripts: true, liveSessions: true},

  modes: [
    {id: 'read-only', label: 'Read-only'},
    {id: 'accept', label: 'Accept edits', flags: ['--accept-edits']},
    {id: 'plan', label: 'Plan', flags: ['--plan']},
    {id: 'full', label: 'Full access', flags: ['--yolo']},
  ],

  available() {
    const entry = resolveEntry();
    if (entry) return {ok: true, detail: entry};
    try {
      execFileSync(process.platform === 'win32' ? 'cmdc.cmd' : 'cmdc', ['--version'], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      return {ok: true, detail: 'cmdc on PATH'};
    } catch {
      return {ok: false, detail: 'command-code is not installed (npm i -g command-code)'};
    }
  },

  // The command the server should run for auxiliary calls such as --list-models.
  command() {
    const entry = resolveEntry();
    if (entry) return {file: process.execPath, args: [entry]};
    return {
      file: process.platform === 'win32' ? 'cmdc.cmd' : 'cmdc',
      args: [],
      shell: process.platform === 'win32',
    };
  },

  turnArgs({sessionId, mode, model, effort, maxTurns}) {
    const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns || 60), '--skip-onboarding'];
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    const declared = this.modes.find((entry) => entry.id === mode);
    if (declared && declared.flags) args.push(...declared.flags);
    return args;
  },

  spawn(args, cwd) {
    const options = {
      cwd,
      env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'},
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    const entry = resolveEntry();
    if (entry) return spawn(process.execPath, [entry, ...args], options);
    return spawn('cmdc', args, {...options, shell: true});
  },

  // Maps one of Command Code's NDJSON frames onto the normalized events the app understands.
  parse(frame) {
    const events = [];
    if (!frame || typeof frame !== 'object') return events;

    if (frame.type === 'event' && frame.event) {
      const ev = frame.event;
      switch (ev.type) {
        case 'text_delta':
          if (ev.delta) events.push({type: 'text', text: ev.delta});
          break;
        case 'message_end': {
          const content = Array.isArray(ev.content) ? ev.content : [];
          for (const part of content) {
            if (part.type === 'tool_use') {
              events.push({
                type: 'tool',
                id: part.id,
                name: part.name,
                status: 'queued',
                input: summariseInput(part.input),
              });
            }
          }
          break;
        }
        case 'tool_running':
          events.push({
            type: 'tool',
            id: ev.toolCallId,
            name: ev.toolName,
            status: 'running',
            description: ev.description || null,
          });
          break;
        case 'tool_completed':
        case 'tool_errored':
        case 'tool_denied': {
          const status =
            ev.type === 'tool_completed' ? 'done' : ev.type === 'tool_denied' ? 'denied' : 'error';
          const result = Array.isArray(ev.result)
            ? ev.result.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
            : typeof ev.result === 'string'
              ? ev.result
              : '';
          events.push({
            type: 'tool',
            id: ev.toolCallId,
            name: ev.toolName,
            status,
            result: result.slice(0, 4000),
          });
          break;
        }
        case 'model_request_start':
          if (ev.model) events.push({type: 'model', model: ev.model});
          break;
        case 'run_end': {
          const result = ev.result || {};
          if (result.nextState && result.nextState.sessionId) {
            events.push({type: 'session', sessionId: result.nextState.sessionId});
          }
          if (result.finalText) events.push({type: 'final', text: result.finalText});
          if (result.usage) events.push({type: 'usage', usage: result.usage});
          break;
        }
        case 'run_error':
          events.push({type: 'error', message: ev.message || ev.error || 'The run failed.'});
          break;
        default:
          break;
      }
      return events;
    }

    if (frame.type === 'result') {
      if (frame.sessionId) events.push({type: 'session', sessionId: frame.sessionId});
      if (frame.finalText) events.push({type: 'final', text: frame.finalText});
      if (frame.usage) events.push({type: 'usage', usage: frame.usage});
      if (frame.subtype === 'error') {
        events.push({type: 'error', message: frame.error || 'Command Code reported an error.'});
      } else if (frame.subtype) {
        events.push({type: 'done', subtype: frame.subtype});
      }
    }
    return events;
  },

  sessions({workspace, limit = 200} = {}) {
    const wanted = workspace ? normalisePath(workspace) : null;
    return [...sessionIndex().values()]
      .filter((item) => !wanted || normalisePath(item.cwd) === wanted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        title: item.title || '',
        cwd: item.cwd,
        model: item.model,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        active: Date.now() - item.updatedAt < 120000,
      }));
  },

  transcript(sessionId) {
    if (!sessionId) return [];
    const item = sessionIndex().get(sessionId);
    if (!item) return [];
    return readTranscript(item.file);
  },

  // Called after a turn so the next catalog read sees the session the turn just created.
  invalidate() {
    indexCache = {at: 0, index: new Map()};
  },
};
