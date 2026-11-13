'use strict';

const $ = (selector) => document.querySelector(selector);

const els = {
  app: $('#app'),
  main: $('#main'),
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  newChat: $('#new-chat'),
  newChatTop: $('#new-chat-top'),
  searchToggle: $('#search-toggle'),
  searchWrap: $('#search-wrap'),
  search: $('#search'),
  addProject: $('#add-project'),
  addProjectBar: $('#add-project-bar'),
  tabSessions: $('#tab-sessions'),
  logout: $('#logout'),
  chatList: $('#chat-list'),
  workGroup: $('#work-group'),
  workList: $('#work-list'),
  projectList: $('#project-list'),
  workspace: $('#workspace'),
  menu: $('#menu'),
  convTitle: $('#conv-title'),
  convMeta: $('#conv-meta'),
  livePill: $('#live-pill'),
  scroll: $('#scroll'),
  empty: $('#empty'),
  messages: $('#messages'),
  project: $('#project'),
  suggestions: $('#suggestions'),
  form: $('#composer'),
  input: $('#input'),
  send: $('#send'),
  stop: $('#stop'),
  mode: $('#mode'),
  model: $('#model'),
  externalNote: $('#external-note'),
  scrim: $('#scrim'),
};

const state = {
  conversations: [],
  projects: [],
  sessions: new Map(), // workspace path -> sessions[]
  expanded: new Set(),
  workspace: localStorage.getItem('thechambers-workspace') || '',
  serverWorkspace: '',
  filter: '',
  activeId: null,
  busy: false,
  pollTimer: null,
  signature: '',
};

const live = {bubble: null, tools: new Map(), toolsEl: null, text: '', timer: null, pinned: true};

// ---------------------------------------------------------------------------
// Text helpers
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
  const res = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Not signed in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
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
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString();
}

function nearBottom() {
  const el = els.scroll;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function scrollDown(force = false) {
  if (!force && !live.pinned) return;
  els.scroll.scrollTop = els.scroll.scrollHeight;
}

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
// Sidebar
// ---------------------------------------------------------------------------

function itemButton(label, {glyph, active, live: isLive, count, nested} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `item${nested ? ' nested' : ''}${active ? ' active' : ''}`;

  if (glyph) {
    const span = document.createElement('span');
    span.className = 'glyph';
    span.textContent = glyph;
    button.append(span);
  }

  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  button.append(text);

  if (isLive) {
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    button.append(dot);
  }
  if (count) {
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = String(count);
    button.append(badge);
  }
  return button;
}

function matches(text) {
  if (!state.filter) return true;
  return (text || '').toLowerCase().includes(state.filter.toLowerCase());
}

function renderChats() {
  els.chatList.textContent = '';
  const chats = state.conversations.filter((conv) => matches(conv.title));
  if (!chats.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = state.filter ? 'No matching chats.' : 'No chats yet.';
    els.chatList.append(empty);
    return;
  }
  for (const conv of chats.slice(0, 8)) {
    const button = itemButton(conv.title || 'Untitled', {
      active: conv.id === state.activeId,
      live: conv.running,
    });
    button.title = `${conv.workspace} · ${relativeTime(conv.updatedAt)}`;
    button.addEventListener('click', () => {
      closeNav();
      openConversation(conv.id);
    });
    els.chatList.append(button);
  }
}

function renderWork() {
  const working = state.conversations.filter((conv) => conv.running);
  els.workGroup.hidden = !working.length;
  if (!working.length) return;

  els.workList.textContent = '';
  for (const conv of working) {
    const button = itemButton(conv.title || 'Untitled', {active: conv.id === state.activeId, live: true});
    button.addEventListener('click', () => {
      closeNav();
      openConversation(conv.id);
    });
    els.workList.append(button);
  }
}

function renderProjects() {
  els.projectList.textContent = '';
  const projects = state.projects.filter((project) => matches(project.name) || matches(project.path));

  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = 'No projects yet.';
    els.projectList.append(empty);
    return;
  }

  for (const project of projects) {
    const isOpen = state.expanded.has(project.path);
    const selected = project.path === state.workspace;
    const row = itemButton(`${project.name}`, {
      glyph: isOpen ? '▾' : '▸',
      active: selected && !state.activeId,
      count: project.sessions || 0,
    });
    row.title = project.path;
    row.addEventListener('click', () => toggleProject(project.path));
    els.projectList.append(row);

    if (!isOpen) continue;

    const sessions = (state.sessions.get(project.path) || []).filter(
      (session) => matches(session.title || session.id),
    );

    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-row';
      empty.style.paddingLeft = '30px';
      empty.textContent = 'No sessions yet.';
      els.projectList.append(empty);
      continue;
    }

    for (const session of sessions.slice(0, 6)) {
      const button = itemButton(session.title || session.id.slice(0, 8), {
        nested: true,
        live: session.active,
      });
      button.title = `${relativeTime(session.updatedAt)}${session.model ? ` · ${session.model}` : ''}`;
      button.addEventListener('click', () => {
        closeNav();
        resumeSession(session.id);
      });
      els.projectList.append(button);
    }
  }
}

function renderSidebar() {
  renderChats();
  renderWork();
  renderProjects();
}

function renderProjectsSelect() {
  els.project.textContent = '';
  const seen = new Set();
  for (const project of state.projects) {
    if (seen.has(project.path)) continue;
    seen.add(project.path);
    const option = document.createElement('option');
    option.value = project.path;
    option.textContent = project.name;
    option.title = project.path;
    if (project.path === state.workspace) option.selected = true;
    els.project.append(option);
  }
  if (state.workspace && !seen.has(state.workspace)) {
    const option = document.createElement('option');
    option.value = state.workspace;
    option.textContent = baseName(state.workspace);
    option.selected = true;
    els.project.append(option);
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects || [];
  state.serverWorkspace = data.current;
  const known = state.projects.some((project) => project.path === state.workspace);
  if (!state.workspace || !known) {
    state.workspace = state.serverWorkspace;
    localStorage.setItem('thechambers-workspace', state.workspace);
  }
  els.workspace.textContent = state.workspace;
  els.workspace.title = state.workspace;
  renderProjectsSelect();
}

async function loadState() {
  const data = await api('/api/state');
  state.conversations = data.conversations || [];
  renderSidebar();
}

async function loadSessions(workspace = state.workspace) {
  if (!workspace) return;
  try {
    const data = await api(`/api/sessions?workspace=${encodeURIComponent(workspace)}`);
    state.sessions.set(workspace, data.sessions || []);
  } catch {
    state.sessions.set(workspace, []);
  }
  renderSidebar();
}

async function setWorkspace(workspace, {expand = true} = {}) {
  state.workspace = workspace;
  localStorage.setItem('thechambers-workspace', workspace);
  els.workspace.textContent = workspace;
  els.workspace.title = workspace;
  renderProjectsSelect();
  if (expand) state.expanded.add(workspace);
  await loadSessions(workspace);
  renderSidebar();
}

async function toggleProject(workspace) {
  if (state.expanded.has(workspace)) {
    state.expanded.delete(workspace);
    renderSidebar();
    return;
  }
  await setWorkspace(workspace);
}

// ---------------------------------------------------------------------------
// Conversation view
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
    node.querySelector('pre').textContent = payload.result;
  }
  scrollDown();
}

function showEmptyState(title = 'New session') {
  els.main.classList.add('empty-mode');
  els.empty.hidden = false;
  els.messages.hidden = true;
  els.messages.textContent = '';
  els.suggestions.hidden = false;
  els.convTitle.textContent = title;
  els.convMeta.textContent = state.workspace ? baseName(state.workspace) : '';
  setExternal(false);
}

function renderHistory(messages) {
  els.messages.textContent = '';
  live.bubble = null;
  live.toolsEl = null;
  live.tools = new Map();

  els.main.classList.remove('empty-mode');
  els.empty.hidden = true;
  els.messages.hidden = false;
  els.suggestions.hidden = true;

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

async function openConversation(id) {
  try {
    const conv = await api(`/api/conversations/${id}`);
    state.activeId = conv.id;
    els.convTitle.textContent = conv.title || 'Conversation';
    const bits = [baseName(conv.workspace)];
    if (conv.sessionId) bits.push(`session ${conv.sessionId.slice(0, 8)}`);
    els.convMeta.textContent = bits.filter(Boolean).join(' · ');
    state.signature = conversationSignature(conv.messages || []);
    renderHistory(conv.messages || []);
    setExternal(Boolean(conv.externalActive));
    renderSidebar();
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
    live.pinned = nearBottom();
    renderHistory(conv.messages || []);
    if (conv.title) els.convTitle.textContent = conv.title;
  } catch {
    /* a dropped poll is harmless */
  }
}

function newChat() {
  state.activeId = null;
  state.signature = '';
  stopWatching();
  showEmptyState();
  renderSidebar();
  closeNav();
  els.input.focus();
}

async function resumeSession(sessionId) {
  try {
    const conv = await api('/api/sessions/resume', {
      method: 'POST',
      body: JSON.stringify({sessionId}),
    });
    await openConversation(conv.id);
    await loadState();
  } catch (err) {
    els.convMeta.textContent = err.message;
  }
}

function setBusy(busy) {
  state.busy = busy;
  els.send.hidden = busy;
  els.stop.hidden = !busy;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function handleStreamEvent(payload) {
  switch (payload.t) {
    case 'start':
      state.activeId = payload.conversationId;
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
  if (state.activeId === null) {
    els.main.classList.remove('empty-mode');
    els.empty.hidden = true;
    els.messages.hidden = false;
    els.suggestions.hidden = true;
  }
  appendUser(text);
  startAssistant();
  setBusy(true);
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
      throw new Error(data.error || `Request failed (${response.status})`);
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
  } finally {
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
    renderLive();
    setBusy(false);
    loadState().catch(() => {});
    if (state.expanded.has(state.workspace)) loadSessions(state.workspace);
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

els.suggestions.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip || state.busy) return;
  const prompt = chip.dataset.prompt || chip.textContent;
  els.input.value = prompt;
  els.form.requestSubmit();
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

els.project.addEventListener('change', () => setWorkspace(els.project.value));

async function promptForProject() {
  const path = prompt('Folder to work in (full path on this machine):');
  if (!path) return;
  try {
    const data = await api('/api/workspaces', {method: 'POST', body: JSON.stringify({path})});
    await loadProjects();
    await setWorkspace(data.path);
    await loadProjects();
  } catch (err) {
    alert(err.message);
  }
}

els.addProject.addEventListener('click', promptForProject);
els.addProjectBar.addEventListener('click', promptForProject);

els.searchToggle.addEventListener('click', () => {
  els.searchWrap.hidden = !els.searchWrap.hidden;
  if (!els.searchWrap.hidden) els.search.focus();
  else {
    els.search.value = '';
    state.filter = '';
    renderSidebar();
  }
});

els.search.addEventListener('input', () => {
  state.filter = els.search.value.trim();
  renderSidebar();
});

els.tabSessions.addEventListener('click', async () => {
  state.expanded.add(state.workspace);
  await loadSessions(state.workspace);
  els.projectList.scrollIntoView({block: 'nearest'});
});

els.newChat.addEventListener('click', newChat);
els.newChatTop.addEventListener('click', newChat);

els.logout.addEventListener('click', async () => {
  await fetch('/api/logout', {method: 'POST'}).catch(() => {});
  location.href = '/login';
});

els.scroll.addEventListener('scroll', () => {
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

els.sidebarToggle.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches) {
    els.app.classList.contains('nav-open') ? closeNav() : openNav();
    return;
  }
  els.app.classList.toggle('side-collapsed');
});

async function boot() {
  const savedMode = localStorage.getItem('thechambers-mode');
  if (savedMode === 'full') {
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

  state.expanded.add(state.workspace);
  await loadSessions(state.workspace);

  if (state.conversations.length) {
    await openConversation(state.conversations[0].id);
  } else {
    newChat();
  }
}

boot();
