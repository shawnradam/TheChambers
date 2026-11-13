'use strict';

const $ = (selector) => document.querySelector(selector);

const els = {
  app: $('#app'),
  list: $('#conversation-list'),
  sessionList: $('#session-list'),
  messages: $('#messages'),
  title: $('#conv-title'),
  convMeta: $('#conv-meta'),
  status: $('#status-dot'),
  input: $('#input'),
  form: $('#composer'),
  send: $('#send'),
  stop: $('#stop'),
  mode: $('#mode'),
  model: $('#model'),
  workspace: $('#workspace'),
  project: $('#project'),
  addProject: $('#add-project'),
  tabChats: $('#tab-chats'),
  tabSessions: $('#tab-sessions'),
  menu: $('#menu'),
  scrim: $('#scrim'),
  newChat: $('#new-chat'),
  logout: $('#logout'),
  livePill: $('#live-pill'),
  externalNote: $('#external-note'),
};

const state = {
  conversations: [],
  projects: [],
  sessions: [],
  workspace: localStorage.getItem('thechambers-workspace') || '',
  serverWorkspace: '',
  host: '',
  port: '',
  activeId: null,
  activeWorkspace: '',
  tab: 'chats',
  busy: false,
  pollTimer: null,
  signature: '',
};

const live = {bubble: null, tools: new Map(), toolsEl: null, text: '', timer: null, pinned: true};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
}

function inlineMarkup(text) {
  let out = text;
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
  );
  return out;
}

function renderMarkdown(source) {
  const lines = escapeHtml(source).split('\n');
  const out = [];
  let inCode = false;
  let code = [];
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inlineMarkup(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inlineMarkup(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inlineMarkup(numbered[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${inlineMarkup(line)}</p>`);
  }

  if (inCode) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  closeList();
  return out.join('');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {'Content-Type': 'application/json'},
    ...options,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Not signed in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function nearBottom() {
  const el = els.messages;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function scrollDown(force = false) {
  if (!force && !live.pinned) return;
  els.messages.scrollTop = els.messages.scrollHeight;
}

function baseName(fullPath) {
  if (!fullPath) return '';
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || fullPath;
}

function relativeTime(value) {
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Cheap fingerprint of a transcript: if this changes, another process appended to the session.
function conversationSignature(messages) {
  if (!messages.length) return '0';
  const last = messages[messages.length - 1];
  return `${messages.length}:${last.role}:${(last.text || '').length}:${(last.tools || []).length}`;
}

function setExternal(active) {
  els.livePill.hidden = !active;
  els.externalNote.hidden = !active;
}

// ---------------------------------------------------------------------------
// Sidebar: projects, chats, sessions
// ---------------------------------------------------------------------------

function renderProjects() {
  els.project.textContent = '';
  const paths = new Set();
  for (const project of state.projects) paths.add(project.path);
  if (state.workspace) paths.add(state.workspace);

  for (const path of paths) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = baseName(path);
    option.title = path;
    if (path === state.workspace) option.selected = true;
    els.project.append(option);
  }
}

function renderList() {
  els.list.textContent = '';
  if (!state.conversations.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.style.padding = '8px 10px';
    empty.textContent = 'No chats yet.';
    els.list.append(empty);
    return;
  }
  for (const conv of state.conversations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conv';
    if (conv.id === state.activeId) button.classList.add('active');
    if (conv.running) button.classList.add('running');

    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = conv.title || 'Untitled';
    const sub = document.createElement('span');
    sub.className = 'conv-sub';
    sub.textContent = `${baseName(conv.workspace)} · ${relativeTime(conv.updatedAt)}`;
    button.append(title, sub);

    button.addEventListener('click', () => {
      closeNav();
      openConversation(conv.id);
    });
    els.list.append(button);
  }
}

function renderSessions() {
  els.sessionList.textContent = '';

  const header = document.createElement('p');
  header.className = 'meta';
  header.style.padding = '8px 10px';
  header.textContent = `Sessions in ${baseName(state.workspace) || 'this project'}`;
  els.sessionList.append(header);

  if (!state.sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.style.padding = '0 10px 8px';
    empty.textContent = 'No sessions on disk for this folder yet.';
    els.sessionList.append(empty);
    return;
  }

  for (const session of state.sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conv';

    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = session.title || session.id.slice(0, 8);
    const sub = document.createElement('span');
    sub.className = 'conv-sub';
    sub.textContent = session.active
      ? `● live now · ${relativeTime(session.updatedAt)}`
      : `${relativeTime(session.updatedAt)}${session.model ? ` · ${session.model}` : ''}`;
    button.append(title, sub);

    button.addEventListener('click', () => {
      closeNav();
      resumeSession(session.id);
    });
    els.sessionList.append(button);
  }
}

function setTab(tab) {
  state.tab = tab;
  const chats = tab === 'chats';
  els.tabChats.classList.toggle('active', chats);
  els.tabSessions.classList.toggle('active', !chats);
  els.list.hidden = !chats;
  els.sessionList.hidden = chats;
  if (!chats) loadSessions();
}

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects || [];
  state.serverWorkspace = data.current;
  const known = state.projects.some((project) => project.path === state.workspace);
  if (!state.workspace || !known) {
    state.workspace = state.serverWorkspace;
    localStorage.setItem('thechambers-workspace', state.workspace);
  }
  renderProjects();
  els.workspace.textContent = state.workspace;
  els.workspace.title = state.workspace;
}

async function loadSessions() {
  if (!state.workspace) return;
  try {
    const data = await api(`/api/sessions?workspace=${encodeURIComponent(state.workspace)}`);
    state.sessions = data.sessions || [];
  } catch (err) {
    state.sessions = [];
    console.error(err);
  }
  renderSessions();
}

async function resumeSession(sessionId) {
  try {
    const conv = await api('/api/sessions/resume', {
      method: 'POST',
      body: JSON.stringify({sessionId}),
    });
    setTab('chats');
    await openConversation(conv.id);
    await loadState();
  } catch (err) {
    els.convMeta.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function messageNode(role) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  wrap.append(bubble);
  return {wrap, bubble};
}

function toolNode(tool) {
  const details = document.createElement('details');
  details.className = 'tool';
  details.dataset.status = tool.status || 'queued';
  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = tool.name;
  const status = document.createElement('span');
  status.className = 'state';
  status.textContent = tool.status || 'queued';
  summary.append(name, status);
  const body = document.createElement('pre');
  body.textContent = (tool.result || tool.input || '').trim() || 'No details.';
  details.append(summary, body);
  return details;
}

function appendUser(text) {
  const {wrap, bubble} = messageNode('user');
  bubble.textContent = text;
  els.messages.append(wrap);
  scrollDown(true);
}

function startAssistant() {
  const {wrap, bubble} = messageNode('assistant');
  const toolsEl = document.createElement('div');
  toolsEl.className = 'tools';
  wrap.append(toolsEl);
  els.messages.append(wrap);
  live.bubble = bubble;
  live.toolsEl = toolsEl;
  live.tools = new Map();
  live.text = '';
  live.pinned = true;
  // Command Code takes a moment to boot; say so instead of showing an empty bubble.
  live.bubble.innerHTML = '<p class="pending">Starting Command Code<span class="dots">…</span></p>';
  scrollDown(true);
}

function renderLive() {
  if (!live.bubble) return;
  live.bubble.innerHTML = renderMarkdown(live.text);
  scrollDown();
}

function scheduleLiveRender() {
  if (live.timer) return;
  live.timer = setTimeout(() => {
    live.timer = null;
    renderLive();
  }, 80);
}

function upsertTool(payload) {
  if (!live.toolsEl) return;
  if (!live.text && live.bubble?.querySelector('.pending')) live.bubble.textContent = '';
  let node = live.tools.get(payload.id);
  if (!node) {
    node = toolNode({name: payload.name, status: payload.status, input: payload.description});
    live.tools.set(payload.id, node);
    live.toolsEl.append(node);
  }
  node.dataset.status = payload.status || node.dataset.status;
  const status = node.querySelector('.state');
  if (status) status.textContent = payload.status || status.textContent;
  if (payload.name) {
    const name = node.querySelector('.name');
    if (name) name.textContent = payload.name;
  }
  if (payload.result) {
    const body = node.querySelector('pre');
    body.textContent = payload.result;
  }
  scrollDown();
}

function renderHistory(messages) {
  els.messages.textContent = '';
  live.bubble = null;
  live.toolsEl = null;
  live.tools = new Map();

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      'Ask Command Code to read, explain, or change code in this project. Read-only mode is the safe default; Full access lets it write files and run commands.';
    els.messages.append(empty);
    return;
  }

  for (const message of messages) {
    if (message.role === 'user') {
      appendUser(message.text || '');
      continue;
    }
    const {wrap, bubble} = messageNode('assistant');
    bubble.innerHTML = renderMarkdown(message.text || '');
    const tools = Array.isArray(message.tools) ? message.tools : [];
    if (tools.length) {
      const toolsEl = document.createElement('div');
      toolsEl.className = 'tools';
      for (const tool of tools) toolsEl.append(toolNode(tool));
      wrap.insertBefore(toolsEl, bubble.nextSibling);
    }
    if (message.stopped) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'Stopped.';
      wrap.append(note);
    }
    if (message.error) {
      const note = document.createElement('p');
      note.className = 'note error';
      note.textContent = message.error;
      wrap.append(note);
    }
    els.messages.append(wrap);
  }
  scrollDown(true);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

async function loadState() {
  const data = await api('/api/state');
  state.conversations = data.conversations || [];
  state.host = data.host || '';
  state.port = data.port || '';
  renderList();
  if (state.tab === 'sessions') loadSessions();
}

async function openConversation(id) {
  try {
    const conv = await api(`/api/conversations/${id}`);
    state.activeId = conv.id;
    state.activeWorkspace = conv.workspace || '';
    els.title.textContent = conv.title || 'Conversation';
    const bits = [baseName(conv.workspace)];
    if (conv.sessionId) bits.push(`session ${conv.sessionId.slice(0, 8)}`);
    els.convMeta.textContent = bits.filter(Boolean).join(' · ');
    state.signature = conversationSignature(conv.messages || []);
    renderHistory(conv.messages || []);
    setExternal(Boolean(conv.externalActive));
    renderList();
    startWatching();
  } catch (err) {
    els.convMeta.textContent = err.message;
  }
}

async function refreshConversation() {
  if (!state.activeId || state.busy) return;
  try {
    const conv = await api(`/api/conversations/${state.activeId}`);
    state.signature = conversationSignature(conv.messages || []);
    renderHistory(conv.messages || []);
    setExternal(Boolean(conv.externalActive));
  } catch {
    /* the stream already showed the answer */
  }
}

// Polls the session while the conversation is open. Turns written by a terminal land on disk
// when they commit, so this is what makes the two views feel like one chat.
function startWatching() {
  stopWatching();
  state.pollTimer = setInterval(pollConversation, 2500);
}

function stopWatching() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollConversation() {
  if (!state.activeId || state.busy || document.hidden) return;
  try {
    const conv = await api(`/api/conversations/${state.activeId}`);
    setExternal(Boolean(conv.externalActive));
    const signature = conversationSignature(conv.messages || []);
    if (signature === state.signature) return;
    state.signature = signature;
    const pinned = nearBottom();
    live.pinned = pinned;
    renderHistory(conv.messages || []);
    if (conv.title) els.title.textContent = conv.title;
  } catch {
    /* a dropped poll is harmless; the next one retries */
  }
}

function newChat() {
  state.activeId = null;
  state.activeWorkspace = state.workspace;
  state.signature = '';
  stopWatching();
  setExternal(false);
  els.title.textContent = 'New conversation';
  els.convMeta.textContent = baseName(state.workspace);
  renderHistory([]);
  renderList();
  closeNav();
  els.input.focus();
}

function setBusy(busy) {
  state.busy = busy;
  els.send.hidden = busy;
  els.stop.hidden = !busy;
  els.status.classList.toggle('busy', busy);
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function handleStreamEvent(payload) {
  switch (payload.t) {
    case 'start':
      state.activeId = payload.conversationId;
      state.activeWorkspace = payload.workspace || state.activeWorkspace;
      break;
    case 'text':
      live.text += payload.d || '';
      scheduleLiveRender();
      break;
    case 'tool':
      upsertTool(payload);
      break;
    case 'model':
      els.model.textContent = payload.model || '';
      break;
    case 'error':
      if (live.bubble) {
        const note = document.createElement('p');
        note.className = 'note error';
        note.textContent = payload.message;
        live.bubble.append(note);
      }
      els.status.classList.add('error');
      break;
    case 'done':
      if (payload.stopped) {
        const note = document.createElement('p');
        note.className = 'note';
        note.textContent = 'Stopped.';
        live.bubble?.parentElement.append(note);
      }
      break;
    default:
      break;
  }
}

async function sendTurn(text) {
  appendUser(text);
  startAssistant();
  setBusy(true);
  els.status.classList.remove('error');
  els.model.textContent = '';

  try {
    const response = await fetch('/api/turn', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        conversationId: state.activeId,
        workspace: state.activeId ? undefined : state.workspace,
        text,
        mode: els.mode.value,
      }),
    });

    if (response.status === 401) {
      location.href = '/login';
      return;
    }

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let failed = false;

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});

      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let payload;
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (payload.t === 'done' && payload.error) failed = true;
          handleStreamEvent(payload);
        }
      }
    }

    if (!failed) await refreshConversation();
  } catch (err) {
    const note = document.createElement('p');
    note.className = 'note error';
    note.textContent = err.message;
    live.bubble?.append(note);
    els.status.classList.add('error');
  } finally {
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
    renderLive();
    setBusy(false);
    loadState().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.busy) return;
  els.input.value = '';
  els.input.style.height = 'auto';
  sendTurn(text);
});

els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, window.innerHeight * 0.4)}px`;
});

els.input.addEventListener('keydown', (event) => {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (event.key === 'Enter' && !event.shiftKey && !coarse) {
    event.preventDefault();
    els.form.requestSubmit();
  }
});

els.stop.addEventListener('click', async () => {
  if (!state.activeId) return;
  els.stop.disabled = true;
  try {
    await api('/api/stop', {
      method: 'POST',
      body: JSON.stringify({conversationId: state.activeId}),
    });
  } catch {
    /* nothing running is fine */
  } finally {
    els.stop.disabled = false;
  }
});

els.mode.addEventListener('change', () => {
  localStorage.setItem('thechambers-mode', els.mode.value);
  els.mode.classList.toggle('full', els.mode.value === 'full');
});

els.project.addEventListener('change', async () => {
  state.workspace = els.project.value;
  localStorage.setItem('thechambers-workspace', state.workspace);
  els.workspace.textContent = state.workspace;
  els.workspace.title = state.workspace;
  await loadSessions();
});

els.addProject.addEventListener('click', async () => {
  const path = prompt('Folder to work in (full path on this machine):');
  if (!path) return;
  try {
    const data = await api('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({path}),
    });
    state.workspace = data.path;
    localStorage.setItem('thechambers-workspace', data.path);
    await loadProjects();
    els.workspace.textContent = data.path;
    els.workspace.title = data.path;
    await loadSessions();
  } catch (err) {
    alert(err.message);
  }
});

els.tabChats.addEventListener('click', () => setTab('chats'));
els.tabSessions.addEventListener('click', () => setTab('sessions'));

els.newChat.addEventListener('click', newChat);

els.logout.addEventListener('click', async () => {
  await fetch('/api/logout', {method: 'POST'}).catch(() => {});
  location.href = '/login';
});

els.messages.addEventListener('scroll', () => {
  live.pinned = nearBottom();
});

function openNav() {
  els.app.classList.add('nav-open');
  els.scrim.hidden = false;
}

function closeNav() {
  els.app.classList.remove('nav-open');
  els.scrim.hidden = true;
}

els.menu.addEventListener('click', openNav);
els.scrim.addEventListener('click', closeNav);

async function boot() {
  const saved = localStorage.getItem('thechambers-mode');
  if (saved === 'full') {
    els.mode.value = 'full';
    els.mode.classList.add('full');
  }

  try {
    await loadProjects();
    await loadState();
  } catch (err) {
    els.convMeta.textContent = err.message;
    return;
  }

  if (state.conversations.length) {
    await openConversation(state.conversations[0].id);
  } else {
    newChat();
  }
}

boot();
