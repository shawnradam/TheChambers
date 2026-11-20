'use strict';

// TheChambers client. The layout is this project's own; the data comes from
// Command Code's own sessions through the local server.

const $ = (selector) => document.querySelector(selector);
const icon = (name, cls = 'icon') => `<svg class="${cls}"><use href="#i-${name}"></use></svg>`;

// On a phone, programmatic focus is the enemy: every view that opens with a field in it would
// pop the soft keyboard. Tapping a field still focuses it natively, so the keyboard appears only
// when the user actually wants to type.
if (window.matchMedia('(pointer: coarse)').matches) {
  HTMLElement.prototype.focus = function () {
    /* deliberately inert on touch devices */
  };
}

const els = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  sidebarClose: $('#sidebar-close'),
  newChat: $('#new-chat'),
  newChatGroup: $('#new-chat-group'),
  searchToggle: $('#search-toggle'),
  searchWrap: $('#search-wrap'),
  search: $('#search'),
  addProject: $('#add-project'),
  addProjectGroup: $('#add-project-group'),
  shortcuts: $('#shortcuts'),
  more: $('#more'),
  chatList: $('#chat-list'),
  workGroup: $('#work-group'),
  workList: $('#work-list'),
  projectList: $('#project-list'),
  hostInfo: $('#host-info'),
  settings: $('#settings'),
  updates: $('#updates'),
  updateDot: $('#update-dot'),
  exportBtn: $('#export'),
  menu: $('#menu'),
  title: $('#conv-title'),
  convMenu: $('#conv-menu'),
  ctxRing: $('#ctx-ring'),
  ctxArc: $('#ctx-arc'),
  ctxPct: $('#ctx-pct'),
  toggleSession: $('#toggle-session'),
  scroll: $('#scroll'),
  empty: $('#empty'),
  thread: $('#thread'),
  slotEmpty: $('#composer-slot-empty'),
  dock: $('#composer-dock'),
  composer: $('#composer'),
  input: $('#input'),
  send: $('#send'),
  stop: $('#stop'),
  docket: $('#docket'),
  gavel: $('#gavel'),
  attach: $('#attach'),
  fileInput: $('#file-input'),
  attachments: $('#attachments'),
  permissions: $('#permissions'),
  goal: $('#goal'),
  concise: $('#concise'),
  modelBtn: $('#model-btn'),
  modelLabel: $('#model-label'),
  agentBtn: $('#agent-btn'),
  agentLabel: $('#agent-label'),
  chooseProject: $('#choose-project'),
  projectMenu: $('#project-menu'),
  suggestions: $('#suggestions'),
  addStarter: $('#add-starter'),
  panel: $('#panel'),
  panelTabs: $('#panel-tabs'),
  panelActions: $('#panel-actions'),
  panelBody: $('#panel-body'),
  sessionPanel: $('#session-panel'),
  sessionCard: $('#session-card'),
  rail: $('#rail'),
  railConfig: $('#rail-config'),
  scrim: $('#scrim'),
  toast: $('#toast'),
  modalRoot: $('#modal-root'),
};

const state = {
  conversations: [],
  projects: [],
  sessions: new Map(),
  expanded: new Set(),
  workspace: localStorage.getItem('thechambers-workspace') || '',
  serverWorkspace: '',
  filter: '',
  activeId: null,
  busy: false,
  docket: [],
  pollTimer: null,
  signature: '',
  messages: [],
  conversation: null,
  lastUsage: null,
  models: null,
  model: localStorage.getItem('thechambers-model') || '',
  permission: localStorage.getItem('thechambers-permission') || 'read-only',
  agent: localStorage.getItem('thechambers-agent') || 'build',
  goal: false,
  concise: localStorage.getItem('thechambers-concise') === '1',
  panel: null,
  panelFile: null,
  git: null,
  gitFile: null,
  tree: new Map(),
  treeOpen: new Set(),
  notes: [],
  notesTab: 'notes',
  term: {lines: [], busy: false},
  browserUrl: '',
  health: null,
  version: '—',
  update: null,
  attachments: [],
  skills: null,
  skillsLoading: false,
  mentionCache: new Map(),
  plugins: [],
  pluginRoot: '',
  picker: {open: false, mode: null, items: [], index: 0, tokenStart: 0, query: '', timer: null},
};

const live = {bubble: null, tools: new Map(), toolsEl: null, text: '', model: '', timer: null, pinned: true, started: 0};

function lastModelOf(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant' && messages[i].model) return messages[i].model;
  }
  return '';
}

function contextLimit() {
  const model =
    state.model || (state.conversation && state.conversation.model) || lastModelOf(state.messages) || '';
  if (!model) return 200000;
  const match = (state.models && state.models.groups ? state.models.groups : [])
    .flatMap((group) => group.models || [])
    .find((entry) => entry.id === model);
  if (match && /1M|1m context|long-context/i.test(match.note || '')) return 1000000;
  if (/deepseek|kimi|glm|qwen|minimax|muse|grok|gemini|longcat|hy4/i.test(model)) return 1000000;
  return 200000;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function baseName(fullPath) {
  if (!fullPath) return '';
  const parts = String(fullPath).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || fullPath;
}

function shortModel(id) {
  if (!id) return '';
  const name = String(id).split('/').pop();
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function relativeTime(value) {
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d`;
  return new Date(ts).toLocaleDateString();
}

function fmtTokens(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
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
  const lines = esc(source || '').split('\n');
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

function nearBottom() {
  const el = els.scroll;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function scrollDown(force = false) {
  if (!force && !live.pinned) return;
  els.scroll.scrollTop = els.scroll.scrollHeight;
}

function signatureOf(messages) {
  if (!messages.length) return '0';
  const last = messages[messages.length - 1];
  return `${messages.length}:${last.role}:${(last.text || '').length}:${(last.tools || []).length}`;
}

function usageTotals(messages) {
  const totals = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0};
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.usage) continue;
    const u = message.usage;
    totals.input += u.inputTokens || 0;
    totals.output += u.outputTokens || 0;
    totals.cacheRead += u.cacheReadTokens || 0;
    totals.cacheWrite += u.cacheWriteTokens || 0;
    totals.cost += u.costUsd || 0;
    totals.turns += 1;
  }
  return totals;
}

function lastUsageOf(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant' && messages[i].usage) return messages[i].usage;
  }
  return null;
}

function updateContextRing() {
  const usage = state.lastUsage;
  if (!usage) {
    els.ctxPct.textContent = '–';
    els.ctxArc.style.strokeDasharray = '0 100';
    return;
  }
  const used = (usage.inputTokens || 0) + (usage.outputTokens || 0);
  const limit = contextLimit();
  const value = pct(used, limit);
  els.ctxPct.textContent = `${value.toFixed(1)}%`;
  els.ctxArc.style.strokeDasharray = `${value.toFixed(2)} 100`;
  els.ctxRing.title = `${fmtTokens(used)} of ${fmtTokens(limit)} tokens used (estimated window)`;
}

// ---------------------------------------------------------------------------
// Composer placement
// ---------------------------------------------------------------------------

function placeComposer(inEmpty) {
  if (inEmpty) {
    if (els.composer.parentElement !== els.slotEmpty) els.slotEmpty.append(els.composer);
    els.dock.hidden = true;
    els.empty.hidden = false;
    els.thread.hidden = true;
  } else {
    if (els.composer.parentElement !== els.dock) els.dock.append(els.composer);
    els.dock.hidden = false;
    els.empty.hidden = true;
    els.thread.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Menus and modals
// ---------------------------------------------------------------------------

let menuCleanup = null;

function closeMenus() {
  document.querySelectorAll('.menu.floating').forEach((menu) => menu.remove());
  els.projectMenu.hidden = true;
  if (menuCleanup) {
    menuCleanup();
    menuCleanup = null;
  }
  els.more.classList.remove('on');
  els.ctxRing.classList.remove('on');
}

function floatingMenu(anchor, build, {width = 240, above = true} = {}) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu floating';
  menu.style.position = 'fixed';
  menu.style.width = `${width}px`;
  menu.addEventListener('mousedown', (event) => event.stopPropagation());
  build(menu);
  document.body.append(menu);

  const rect = anchor.getBoundingClientRect();
  const height = menu.offsetHeight;
  let top = above ? rect.top - height - 6 : rect.bottom + 6;
  if (top < 8) top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  const onDown = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenus();
  };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  menuCleanup = () => document.removeEventListener('mousedown', onDown);
  return menu;
}

function menuItem(label, {iconName, hint, active, onClick, className = ''} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `menu-item${active ? ' active' : ''}${className ? ` ${className}` : ''}`;
  button.innerHTML = `${iconName ? icon(iconName) : '<span style="width:14px"></span>'}<span class="label">${esc(label)}</span>${
    hint ? `<span class="spacer"></span><span class="hint">${esc(hint)}</span>` : ''
  }${active ? `<span class="spacer"></span>${icon('check')}` : ''}`;
  button.addEventListener('click', () => {
    closeMenus();
    onClick && onClick();
  });
  return button;
}

function menuTitle(text) {
  const div = document.createElement('div');
  div.className = 'menu-title';
  div.textContent = text;
  return div;
}

function menuSep() {
  const div = document.createElement('div');
  div.className = 'menu-sep';
  return div;
}

function openModal({title = '', content = '', width = 640, onOpen} = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:min(${width}px,100%)">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <span class="spacer"></span>
        <button class="icon-btn" data-close type="button" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  const body = backdrop.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else body.append(content);
  els.modalRoot.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  const onKey = (event) => {
    if (event.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  onOpen && onOpen({body, close});
  return {body, close};
}

function openPrompt({title, label, value = '', placeholder = '', confirm = 'Save', onConfirm}) {
  openModal({
    title,
    width: 480,
    content: `
      <label class="label">${esc(label)}</label>
      <input class="text" id="prompt-input" value="${esc(value)}" placeholder="${esc(placeholder)}" />
      <div class="actions">
        <button class="btn" data-cancel type="button">Cancel</button>
        <button class="btn primary" data-ok type="button">${esc(confirm)}</button>
      </div>`,
    onOpen: ({body, close}) => {
      const input = body.querySelector('#prompt-input');
      input.focus();
      input.select();
      const submit = () => {
        const next = input.value.trim();
        if (!next) return;
        close();
        onConfirm(next);
      };
      body.querySelector('[data-ok]').addEventListener('click', submit);
      body.querySelector('[data-cancel]').addEventListener('click', close);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit();
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function matches(...values) {
  if (!state.filter) return true;
  const needle = state.filter.toLowerCase();
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}

function rowShell({active, nested, title}) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `row${nested ? ' nested' : ''}${active ? ' active' : ''}`;
  if (title) row.title = title;
  return row;
}

function renderChats() {
  els.chatList.textContent = '';
  const chats = state.conversations.filter((conv) => matches(conv.title, conv.workspace));
  if (!chats.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = state.filter ? 'No matching chats.' : 'No chats yet.';
    els.chatList.append(empty);
    return;
  }

  for (const conv of chats) {
    const row = rowShell({active: conv.id === state.activeId, title: `${conv.workspace} · ${relativeTime(conv.updatedAt)}`});
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.innerHTML = icon('message');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = conv.title || 'Untitled';
    row.append(glyph, label);

    if (conv.running) {
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      row.append(dot);
    }

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'icon-btn';
    archive.title = 'Archive';
    archive.innerHTML = icon('archive');
    archive.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteConversation(conv.id);
    });
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'icon-btn';
    more.title = 'Session menu';
    more.innerHTML = icon('more');
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      sessionMenu(more, conv);
    });
    actions.append(archive, more);
    row.append(actions);

    row.addEventListener('click', () => {
      closeNav();
      openConversation(conv.id);
    });
    els.chatList.append(row);
  }
}

function renderWork() {
  const working = state.conversations.filter((conv) => conv.running);
  els.workGroup.hidden = !working.length;
  if (!working.length) return;
  els.workList.textContent = '';
  for (const conv of working) {
    const row = rowShell({active: conv.id === state.activeId});
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.innerHTML = icon('chevron-down');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = conv.title || 'Untitled';
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    row.append(glyph, label, dot);
    row.addEventListener('click', () => {
      closeNav();
      openConversation(conv.id);
    });
    els.workList.append(row);
  }
}

function renderProjects() {
  els.projectList.textContent = '';
  const projects = state.projects.filter((project) => matches(project.name, project.path));
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = 'No projects yet.';
    els.projectList.append(empty);
    return;
  }

  for (const project of projects) {
    const isOpen = state.expanded.has(project.path);
    const row = rowShell({active: false, title: project.path});
    row.classList.add('project');

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.innerHTML = icon(isOpen ? 'chevron-down' : 'folder');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = project.name;
    row.append(glyph, label);

    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'icon-btn';
    add.title = 'New session';
    add.innerHTML = icon('plus');
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      state.workspace = project.path;
      localStorage.setItem('thechambers-workspace', project.path);
      if (!state.expanded.has(project.path)) state.expanded.add(project.path);
      loadSessions(project.path);
      newChat();
    });
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'icon-btn';
    more.title = 'Project menu';
    more.innerHTML = icon('more');
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      projectMenuFor(more, project);
    });
    actions.append(add, more);
    row.append(actions);

    row.addEventListener('click', () => {
      state.workspace = project.path;
      localStorage.setItem('thechambers-workspace', project.path);
      if (state.expanded.has(project.path)) {
        state.expanded.delete(project.path);
        renderSidebar();
        return;
      }
      state.expanded.add(project.path);
      loadSessions(project.path);
    });
    els.projectList.append(row);

    if (!isOpen) continue;

    const sessions = (state.sessions.get(project.path) || []).filter((session) =>
      matches(session.title, session.id, session.model),
    );
    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-row';
      empty.style.paddingLeft = '32px';
      empty.textContent = 'No sessions yet.';
      els.projectList.append(empty);
      continue;
    }

    for (const session of sessions) {
      const nested = rowShell({nested: true, title: `${relativeTime(session.updatedAt)}${session.model ? ` · ${session.model}` : ''}`});
      const dot = document.createElement('span');
      dot.className = 'glyph';
      dot.innerHTML = session.active ? icon('dot') : icon('message');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = session.title || session.id.slice(0, 8);
      nested.append(dot, label);
      nested.addEventListener('click', () => {
        closeNav();
        resumeSession(session.id);
      });
      els.projectList.append(nested);
    }
  }
}

function renderSidebar() {
  renderChats();
  renderWork();
  renderProjects();
  els.hostInfo.textContent = '';
}

function sessionMenu(anchor, conv) {
  floatingMenu(
    anchor,
    (menu) => {
      menu.append(
        menuItem('Rename', {
          iconName: 'edit',
          onClick: () =>
            openPrompt({
              title: 'Rename session',
              label: 'Name',
              value: conv.title,
              confirm: 'Rename',
              onConfirm: async (title) => {
                await api(`/api/conversations/${conv.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({title}),
                }).catch((err) => toast(err.message));
                if (state.activeId === conv.id) els.title.textContent = title;
                await loadState();
              },
            }),
        }),
        menuItem('Export', {
          iconName: 'download',
          onClick: () => exportConversation(conv),
        }),
        menuSep(),
        menuItem('Delete', {
          iconName: 'trash',
          onClick: () => deleteConversation(conv.id),
        }),
      );
    },
    {width: 200},
  );
}

function projectMenuFor(anchor, project) {
  floatingMenu(
    anchor,
    (menu) => {
      menu.append(
        menuItem('New session', {
          iconName: 'plus',
          onClick: () => {
            state.workspace = project.path;
            localStorage.setItem('thechambers-workspace', project.path);
            newChat();
          },
        }),
        menuItem('Copy path', {
          iconName: 'copy',
          onClick: () => navigator.clipboard && navigator.clipboard.writeText(project.path),
        }),
        menuItem('Open in Files', {
          iconName: 'file',
          onClick: () => {
            state.workspace = project.path;
            openPanel('files');
          },
        }),
      );
    },
    {width: 200},
  );
}

async function deleteConversation(id) {
  try {
    await api(`/api/conversations/${id}`, {method: 'DELETE'});
    if (state.activeId === id) newChat();
    await loadState();
    toast('Session removed. The transcript file is untouched.');
  } catch (err) {
    toast(err.message);
  }
}

function exportConversation(conv) {
  api(`/api/conversations/${conv.id}`)
    .then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(conv.title || 'session').replace(/[^\w-]+/g, '-').slice(0, 50)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch((err) => toast(err.message));
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
  renderProjectMenu();
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

async function loadHealth() {
  try {
    state.health = await api('/health');
  } catch {
    state.health = null;
  }
  renderSidebar();
}

async function loadNotes() {
  try {
    const data = await api(`/api/notes?workspace=${encodeURIComponent(state.workspace)}`);
    state.notes = data.notes || [];
  } catch {
    state.notes = [];
  }
}

async function loadPlugins() {
  try {
    const data = await api('/api/plugins');
    state.plugins = data.plugins || [];
    state.pluginRoot = data.root || state.pluginRoot;
  } catch {
    state.plugins = [];
  }
  renderPluginRail();
  if (state.panel && state.panel.startsWith('plugin:')) {
    const id = state.panel.slice('plugin:'.length);
    const plugin = state.plugins.find((entry) => entry.id === id);
    if (!plugin || !plugin.enabled || !plugin.loaded) closePanel();
  }
}

async function setWorkspace(workspace) {
  state.workspace = workspace;
  localStorage.setItem('thechambers-workspace', workspace);
  await loadSessions(workspace);
  renderProjectMenu();
  renderSidebar();
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
    toast(err.message);
  }
}

// ---------------------------------------------------------------------------
// Project chooser
// ---------------------------------------------------------------------------

function renderProjectMenu(filter = '') {
  els.projectMenu.textContent = '';
  const search = document.createElement('div');
  search.className = 'menu-search';
  search.innerHTML = `${icon('search')}<input id="project-search" placeholder="Search projects..." />`;
  const input = search.querySelector('input');
  input.value = filter;
  input.addEventListener('input', () => renderProjectMenu(input.value));
  els.projectMenu.append(search);

  const list = document.createElement('div');
  const projects = state.projects.filter((project) =>
    String(project.name || '').toLowerCase().includes(filter.toLowerCase()),
  );
  for (const project of projects) {
    list.append(
      menuItem(project.name, {
        iconName: 'folder',
        active: project.path === state.workspace,
        hint: project.sessions ? String(project.sessions) : '',
        onClick: () => {
          setWorkspace(project.path);
          els.projectMenu.hidden = true;
        },
      }),
    );
  }
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-row';
    empty.textContent = 'No matching projects.';
    list.append(empty);
  }
  els.projectMenu.append(list);
  els.projectMenu.append(menuSep());
  els.projectMenu.append(
    menuItem('Add project…', {
      iconName: 'folder-plus',
      onClick: () => {
        els.projectMenu.hidden = true;
        promptForProject();
      },
    }),
  );
  if (filter) {
    setTimeout(() => {
      const next = els.projectMenu.querySelector('#project-search');
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    }, 0);
  }
}

function promptForProject() {
  openPrompt({
    title: 'Add project',
    label: 'Folder path on this machine',
    placeholder: 'C:\\Users\\you\\project',
    confirm: 'Add',
    onConfirm: async (path) => {
      try {
        const data = await api('/api/workspaces', {method: 'POST', body: JSON.stringify({path})});
        await loadProjects();
        await setWorkspace(data.path);
      } catch (err) {
        toast(err.message);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Conversation view
// ---------------------------------------------------------------------------

function toolNode(tool) {
  const details = document.createElement('details');
  details.className = 'tool';
  details.dataset.status = tool.status || 'queued';
  const summary = document.createElement('summary');
  summary.innerHTML = `${icon('spark')}<span class="name">${esc(tool.name || 'Tool')}</span><span class="state">${esc(
    tool.status || 'queued',
  )}</span>`;
  const body = document.createElement('pre');
  body.textContent = (tool.result || tool.input || '').trim() || 'No details.';
  details.append(summary, body);
  return details;
}

function appendUser(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.append(bubble);
  els.thread.append(wrap);
  scrollDown(true);
}

// What the bubble says while the agent is working. Longer, Claude-style sentences rather than
// single words, so each one has time to read; the mark beside them is the C from the logo with a
// shimmer and a ripple, like a drop landing.
const THINKING_QUOTES = [
  'Reading the files',
  'Checking the wiring',
  'Tracing the call path',
  'Looking for the cause',
  'Testing an idea',
  'Weighing two options',
  'Simplifying the change',
  'Reviewing the diff',
  'Reading the transcript',
  'Checking the endpoint',
  'Tracing the request',
  'Inspecting the layout',
  'Comparing the versions',
  'Verifying the fix',
  'Scanning the log',
  'Following a hunch',
  'Narrowing the search',
  'Mapping the files',
  'Reading the tests',
  'Checking the routes',
  'Fixing the copy',
  'Tidying the code',
  'Naming things well',
  'Removing a branch',
  'Making it smaller',
  'Making it clearer',
  'Explaining the why',
  'Summarising the change',
  'Checking the edge case',
  'Testing on a phone',
  'Checking the width',
  'Reading the errors',
  'Confirming the cause',
  'Trying a second path',
  'Watching the stream',
  'Checking the heartbeat',
  'Waiting on the model',
  'Reading the specs',
  'Checking the types',
  'Looking at the config',
  'Finding the entry point',
  'Following the import',
  'Checking the handler',
  'Reading the schema',
  'Checking the payload',
  'Trimming the response',
  'Checking the tokens',
  'Watching the context',
  'Compacting the history',
  'Reading the session',
  'Resuming the session',
  'Checking the title',
  'Fixing a stale label',
  'Checking the clock',
  'Waiting for the build',
  'Running the check',
  'Reading the result',
  'Confirming it passes',
  'Re-reading the ask',
  'Answering the right thing',
  'Keeping it small',
  'Leaving the rest alone',
  'Checking what changed',
  'Reviewing the commit',
  'Staging the change',
  'Writing the message',
  'Checking the diff',
  'Preparing the push',
  'Checking the remote',
  'Comparing commits',
  'Looking for updates',
  'Reading the release',
  'Checking permissions',
  'Reviewing the guard',
  'Checking the cookie',
  'Reading the header',
  'Validating the origin',
  'Checking the limits',
  'Reading the uploads',
  'Checking the paths',
  'Looking at Tailscale',
  'Reading the address',
  'Checking the port',
  'Freeing the port',
  'Reading the config',
  'Writing the password',
  'Checking the secret',
  'Rotating the session',
  'Signing out machines',
  'Reading the notes',
  'Checking the goals',
  'Reading the plan',
  'Sketching the steps',
  'Taking the first step',
  'Checking the result',
  'Adjusting the approach',
  'Finishing the detail',
  'Reading it once more',
  'Saying it plainly',
  'One last check',
];

let thinkingTimer = null;
let frameTimer = null;
let thinkingIndex = Math.floor(Math.random() * THINKING_QUOTES.length);

// The same working glyphs Command Code's own terminal uses (ink-spinner's "dots", 80ms a frame).
const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function thinkingMarkup(text) {
  return `<div class="thinking" role="status"><span class="c-mark" aria-hidden="true"><span class="c-frame">${THINKING_FRAMES[0]}</span></span><span class="thinking-text">${esc(text)}</span></div>`;
}

function startThinking(bubble) {
  stopThinking();
  const paint = () => {
    if (!bubble || !bubble.isConnected) return stopThinking();
    const phrase = THINKING_QUOTES[thinkingIndex % THINKING_QUOTES.length];
    thinkingIndex += 1;
    const holder = bubble.querySelector('.thinking-text');
    if (!holder) {
      bubble.innerHTML = thinkingMarkup(phrase);
      return;
    }
    holder.textContent = phrase;
    holder.classList.remove('swap');
    void holder.offsetWidth; // restart the fade
    holder.classList.add('swap');
  };
  paint();
  thinkingTimer = setInterval(paint, 2800);

  // One ticker drives both marks: the chat bubble and the tiny one beside the wordmark, so the
  // header always shows that this machine is working even when the thread is scrolled away.
  let frame = 0;
  frameTimer = setInterval(() => {
    const inChat = bubble && bubble.isConnected ? bubble.querySelector('.c-frame') : null;
    const inHeader = document.querySelector('.brand-frame');
    if (!inChat && !inHeader) return;
    frame = (frame + 1) % THINKING_FRAMES.length;
    if (inChat) inChat.textContent = THINKING_FRAMES[frame];
    if (inHeader) inHeader.textContent = THINKING_FRAMES[frame];
  }, 80);
}

function stopThinking() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
}

function startAssistant() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const toolsEl = document.createElement('div');
  toolsEl.className = 'tools';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  wrap.append(toolsEl, bubble);
  els.thread.append(wrap);
  live.bubble = bubble;
  live.toolsEl = toolsEl;
  live.tools = new Map();
  live.text = '';
  live.started = Date.now();
  live.pinned = true;
  startThinking(bubble);
  scrollDown(true);
  return {wrap, bubble};
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
  if (payload.result) node.querySelector('pre').textContent = payload.result;
  scrollDown();
}

function renderFoot(wrap, message) {
  const bits = [];
  if (message.model) bits.push(shortModel(message.model));
  if (message.usage) {
    const used = (message.usage.inputTokens || 0) + (message.usage.outputTokens || 0);
    if (used) bits.push(`${fmtTokens(used)} tokens`);
  }
  if (message.stopped) bits.push('stopped');
  if (!bits.length && !message.error) return;
  const foot = document.createElement('div');
  foot.className = 'msg-foot';
  foot.innerHTML = `${icon('cpu')}<span>${esc(bits.join(' · '))}</span>${
    message.error ? `<span class="sep">·</span><span class="err">${esc(message.error)}</span>` : ''
  }`;
  wrap.append(foot);
}

function renderThread(messages) {
  els.thread.textContent = '';
  live.bubble = null;
  live.toolsEl = null;
  live.tools = new Map();

  for (const message of messages) {
    if (message.role === 'user') {
      const wrap = document.createElement('div');
      wrap.className = 'msg user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = message.text || '';
      wrap.append(bubble);
      els.thread.append(wrap);
      continue;
    }

    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const tools = Array.isArray(message.tools) ? message.tools : [];
    if (tools.length) {
      const toolsEl = document.createElement('div');
      toolsEl.className = 'tools';
      for (const tool of tools) toolsEl.append(toolNode(tool));
      wrap.append(toolsEl);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderMarkdown(message.text || '');
    wrap.append(bubble);
    renderFoot(wrap, message);
    els.thread.append(wrap);
  }
  scrollDown(true);
}

function showEmpty() {
  placeComposer(true);
  els.title.textContent = 'New session';
  els.thread.textContent = '';
  state.messages = [];
  state.lastUsage = null;
  state.signature = '';
  updateContextRing();
  renderSessionCard();
}

function openConversationView() {
  placeComposer(false);
}

async function openConversation(id) {
  try {
    const conv = await api(`/api/conversations/${id}`);
    state.activeId = conv.id;
    localStorage.setItem('thechambers-open', conv.id);
    state.conversation = conv;
    state.messages = conv.messages || [];
    state.lastUsage = lastUsageOf(state.messages);
    state.signature = signatureOf(state.messages);
    els.title.textContent = conv.title || 'Conversation';
    const model = conv.model || lastModelOf(state.messages);
    if (model) {
      conv.model = model;
      setModelLabel(model);
    }
    openConversationView();
    renderThread(state.messages);
    if (typeof conv.concise === 'boolean') {
      state.concise = conv.concise;
      applyConciseState();
    }
    updateContextRing();
    renderSessionCard();
    renderSidebar();
    startWatching();
    if (state.panel === 'context') renderContextPanel();
  } catch (err) {
    toast(err.message);
  }
}

async function refreshConversation(force = false) {
  if (!state.activeId || (state.busy && !force)) return;
  try {
    const conv = await api(`/api/conversations/${state.activeId}`);
    state.messages = conv.messages || [];
    state.conversation = conv;
    state.lastUsage = lastUsageOf(state.messages);
    state.signature = signatureOf(state.messages);
    if (conv.title) els.title.textContent = conv.title;
    const model = conv.model || lastModelOf(state.messages);
    if (model) {
      conv.model = model;
      setModelLabel(model);
    }
    renderThread(state.messages);
    updateContextRing();
    renderSessionCard();
    if (state.panel === 'context') renderContextPanel();
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
    const signature = signatureOf(conv.messages || []);
    if (signature === state.signature) return;
    state.signature = signature;
    state.messages = conv.messages || [];
    state.conversation = conv;
    state.lastUsage = lastUsageOf(state.messages);
    live.pinned = nearBottom();
    renderThread(state.messages);
    updateContextRing();
    renderSessionCard();
    if (state.panel === 'context') renderContextPanel();
    if (conv.title) els.title.textContent = conv.title;
    const model = conv.model || lastModelOf(state.messages);
    if (model) {
      conv.model = model;
      setModelLabel(model);
    }
  } catch {
    /* a dropped poll is harmless */
  }
}

function newChat() {
  state.activeId = null;
  state.conversation = null;
  localStorage.removeItem('thechambers-open');
  stopWatching();
  showEmpty();
  renderSidebar();
  closeNav();
  els.input.focus();
}

function setBusy(busy) {
  state.busy = busy;
  els.send.hidden = busy;
  els.stop.hidden = !busy;
  els.docket.hidden = !busy;
  els.gavel.hidden = !busy;
  els.app.classList.toggle('working', busy);
  updateDocketLabel();
  updateSendState();
}

// While a turn runs the composer offers two choices. The docket holds text and hears it as soon as
// this turn ends; the gavel stops the turn and redirects it now, in the same session.
function updateDocketLabel() {
  els.docket.textContent = state.docket.length ? `Docket ${state.docket.length}` : 'Docket';
  els.docket.title = state.docket.length
    ? `${state.docket.length} filed — click to review`
    : 'File this for after the current turn';
}

function fileDocket() {
  const text = els.input.value.trim();
  if (!text) return false;
  state.docket.push(text);
  els.input.value = '';
  autoGrow();
  updateDocketLabel();
  updateSendState();
  toast(state.docket.length === 1 ? 'Filed to the docket.' : `Docket holds ${state.docket.length}.`);
  return true;
}

function openDocket() {
  floatingMenu(
    els.docket,
    (menu) => {
      if (!state.docket.length) {
        menu.append(menuItem('Nothing filed', {iconName: 'book'}));
        return;
      }
      state.docket.forEach((text, index) => {
        menu.append(
          menuItem(`${index + 1}. ${text.replace(/\s+/g, ' ').slice(0, 48)}`, {
            iconName: 'x',
            onClick: () => {
              state.docket.splice(index, 1);
              updateDocketLabel();
              toast('Removed from the docket.');
            },
          }),
        );
      });
      menu.append(
        menuSep(),
        menuItem('Clear the docket', {
          iconName: 'refresh',
          onClick: () => {
            state.docket = [];
            updateDocketLabel();
            toast('Docket cleared.');
          },
        }),
      );
    },
    {width: 260},
  );
}

function gavelMessage() {
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  autoGrow();
  updateSendState();
  stopTurn();
  toast('Gavel down — stopping, then sending this instead.');
  const started = Date.now();
  const wait = setInterval(() => {
    if (!state.busy || Date.now() - started > 8000) {
      clearInterval(wait);
      sendTurn(text);
    }
  }, 250);
}

function updateSendState() {
  els.send.disabled = state.busy || (!els.input.value.trim() && !state.attachments.length);
  const hasText = Boolean(els.input.value.trim());
  els.docket.disabled = !hasText;
  els.gavel.disabled = !hasText;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function handleStreamEvent(payload) {
  switch (payload.t) {
    case 'start':
      state.activeId = payload.conversationId;
      localStorage.setItem('thechambers-open', payload.conversationId);
      break;
    case 'text':
      if (!live.text) stopThinking();
      live.text += payload.d || '';
      scheduleLiveRender();
      break;
    case 'tool':
      upsertTool(payload);
      break;
    case 'model':
      live.model = payload.model || live.model;
      setModelLabel(live.model);
      break;
    case 'error':
      stopThinking();
      if (live.bubble) {
        const note = document.createElement('p');
        note.className = 'note error';
        note.textContent = payload.message;
        live.bubble.append(note);
      }
      break;
    case 'done':
      stopThinking();
      if (payload.usage) state.lastUsage = payload.usage;
      if (payload.sessionId) state.sessionId = payload.sessionId;
      break;
    default:
      break;
  }
}

async function sendTurn(text) {
  const wasEmpty = !state.activeId;
  openConversationView();
  if (wasEmpty) els.title.textContent = 'New session';
  appendUser(text);
  const {wrap} = startAssistant();
  setBusy(true);
  state.lastUsage = null;
  updateContextRing();

  const mode = state.agent === 'plan' ? 'plan' : state.permission;

  try {
    const response = await fetch('/api/turn', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        conversationId: state.activeId,
        workspace: state.activeId ? undefined : state.workspace,
        text,
        mode,
        model: state.model || undefined,
        concise: state.concise,
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

    if (!failed) await refreshConversation(true);
  } catch (err) {
    // The turn keeps running on the server even when this pipe dies (phone slept, network
    // changed). Try to reload whatever committed instead of shouting "network error" at an
    // answer that is probably already on disk.
    let recovered = false;
    try {
      await refreshConversation(true);
      recovered = true;
    } catch {
      /* the server is unreachable too */
    }
    if (recovered) {
      toast('Connection lost — reloaded from the session transcript.');
    } else {
      const note = document.createElement('p');
      note.className = 'note error';
      note.textContent = err.message;
      wrap.append(note);
    }
  } finally {
    stopThinking();
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
    renderLive();
    if (!live.text && live.bubble) live.bubble.textContent = '';
    if (state.lastUsage) live.bubble && renderSessionCard();
    setBusy(false);
    loadState().catch(() => {});
    if (state.expanded.has(state.workspace)) loadSessions(state.workspace);
    state.goal = false;
    els.goal.classList.remove('on');
    updateContextRing();
    renderSessionCard();

    // The docket is heard: the next item goes out as soon as the turn that held it is done.
    if (state.docket.length) {
      const next = state.docket.shift();
      updateDocketLabel();
      toast(state.docket.length ? `Raising the next item — ${state.docket.length} still filed.` : 'Raising the next item from the docket.');
      setTimeout(() => sendTurn(next), 400);
    }
  }
}

async function stopTurn() {
  if (!state.activeId) return;
  els.stop.disabled = true;
  try {
    await api('/api/stop', {method: 'POST', body: JSON.stringify({conversationId: state.activeId})});
  } catch {
    /* nothing running is fine */
  } finally {
    els.stop.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Session panel and Context
// ---------------------------------------------------------------------------

function usageView() {
  const messages = state.messages || [];
  const totals = usageTotals(messages);
  const last = state.lastUsage || lastUsageOf(messages);
  const used = last ? (last.inputTokens || 0) + (last.outputTokens || 0) : totals.input + totals.output;
  const cacheHit = last && last.inputTokens ? ((last.cacheReadTokens || 0) / last.inputTokens) * 100 : 0;
  return {
    messages: messages.length,
    users: messages.filter((message) => message.role === 'user').length,
    assistants: messages.filter((message) => message.role === 'assistant').length,
    totals,
    last,
    used,
    cacheHit,
    limit: contextLimit(),
    percent: pct(used, contextLimit()),
  };
}

function renderSessionCard() {
  const view = usageView();
  els.sessionCard.innerHTML = `
    <div class="sc-head">Session<span class="spacer"></span>
      <button class="icon-btn" data-close-session type="button" aria-label="Close">${icon('x')}</button>
    </div>
    <div class="sc-body">
      <div class="sc-section">
        <div class="sc-row">${icon('chart')} Context<span class="spacer"></span><b>${view.used ? fmtTokens(view.used) : '—'} / ${fmtTokens(
          view.limit,
        )}</b></div>
        <div class="sc-bar"><span style="width:${view.percent.toFixed(1)}%"></span></div>
        <div class="sc-row">${icon('dot')} Cache Hit<span class="spacer"></span><b>${view.used ? `${view.cacheHit.toFixed(
          1,
        )}%` : '—'}</b></div>
      </div>
      <div class="sc-section">
        <button class="sc-link" data-open-usage type="button">${icon('clock')} Usage<span class="spacer"></span>Daily Requests: ${
          view.assistants
        }</button>
        <button class="sc-link" data-open-context type="button">${icon('book')} Context sources<span class="spacer"></span>${
          state.messages.length
        } messages</button>
        <button class="sc-link" data-open-context type="button">${icon('chart')} Turn stats<span class="spacer"></span>${
          view.totals.turns
        } turns</button>
      </div>
    </div>`;
  const close = els.sessionCard.querySelector('[data-close-session]');
  if (close) {
    close.addEventListener('click', () => {
      els.sessionPanel.hidden = true;
    });
  }
  els.sessionCard.querySelectorAll('[data-open-context],[data-open-usage]').forEach((button) => {
    button.addEventListener('click', () => {
      els.sessionPanel.hidden = true;
      openPanel('context');
    });
  });
}

function panelSwitcherMenu() {
  floatingMenu(
    els.toggleSession,
    (menu) => {
      menu.append(menuTitle('Panels'));
      for (const [name, meta] of Object.entries(panelMeta)) {
        menu.append(
          menuItem(meta.title, {
            iconName: meta.icon,
            active: state.panel === name && !els.panel.hidden,
            onClick: () => openPanel(name),
          }),
        );
      }
    },
    {width: 220},
  );
}

function toggleSessionPanel() {
  if (window.innerWidth <= 900) {
    panelSwitcherMenu();
    return;
  }
  if (window.innerWidth <= 1180) {
    openPanel('context');
    return;
  }
  if (!els.sessionPanel.hidden) {
    els.sessionPanel.hidden = true;
    return;
  }
  closePanel();
  renderSessionCard();
  els.sessionPanel.hidden = false;
}

function renderContextPanel() {
  if (!els.panel || els.panel.hidden || state.panel !== 'context') return;
  const view = usageView();
  const conversation = state.conversation || {};
  const messages = state.messages || [];
  const userChars = messages.filter((m) => m.role === 'user').reduce((sum, m) => sum + (m.text || '').length, 0);
  const assistantChars = messages
    .filter((m) => m.role === 'assistant')
    .reduce((sum, m) => sum + (m.text || '').length + (m.tools || []).reduce((n, t) => n + (t.result || '').length, 0), 0);
  const toolChars = messages.reduce((sum, m) => sum + (m.tools || []).reduce((n, t) => n + (t.result || '').length, 0), 0);
  const totalChars = Math.max(1, userChars + assistantChars + toolChars);
  const shares = [
    {name: 'User', color: '#d0a215', value: (userChars / totalChars) * 100},
    {name: 'Assistant', color: '#da702c', value: ((assistantChars - toolChars) / totalChars) * 100},
    {name: 'Tool Calls', color: '#a0af54', value: (toolChars / totalChars) * 100},
  ];
  const systemShare = Math.max(0, 100 - shares.reduce((sum, item) => sum + item.value, 0));
  const last = view.last || {};
  const totals = view.totals;

  const metric = (label, value) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const raw = messages
    .slice(-30)
    .map(
      (message) =>
        `<div class="raw"><span class="role">${esc(message.role)}</span><span class="txt">${esc(
          (message.text || '').replace(/\s+/g, ' ').slice(0, 120) || `${(message.tools || []).length} tool calls`,
        )}</span></div>`,
    )
    .join('');

  els.panelBody.innerHTML = `
    <div class="ctx-wrap">
      <div class="ctx-head">${esc(conversation.model ? shortModel(conversation.model) : 'Command Code')} / ${
        state.agent === 'plan' ? 'Plan' : 'Build'
      } · ${esc(relativeTime(conversation.updatedAt || Date.now()))}</div>
      <div class="ctx-card">
        <div class="row-line"><span>Context</span><b>${fmtTokens(view.used)} / ${fmtTokens(view.limit)}</b></div>
        <div class="ctx-bar"><span style="width:${view.percent.toFixed(1)}%"></span></div>
        <div class="row-line"><span>${view.percent.toFixed(1)}% used</span><span>${view.last ? 'last turn' : 'no turns yet'}</span></div>
      </div>
      <div class="ctx-grid">
        <div class="cell"><div class="k">Messages</div><div class="v">${view.messages}</div></div>
        <div class="cell"><div class="k">User</div><div class="v">${view.users}</div></div>
        <div class="cell"><div class="k">Assistant</div><div class="v">${view.assistants}</div></div>
        <div class="cell"><div class="k">Cost</div><div class="v">$${(totals.cost || 0).toFixed(4)}</div></div>
      </div>
      <div class="ctx-card">
        <div class="ctx-section-title">Session Totals</div>
        <div class="ctx-metrics">
          ${metric('Input', fmtTokens(totals.input))}
          ${metric('Output', fmtTokens(totals.output))}
          ${metric('Cache Read', fmtTokens(totals.cacheRead))}
          ${metric('Cache Write', fmtTokens(totals.cacheWrite))}
          ${metric('Cache Hit', view.cacheHit ? `${view.cacheHit.toFixed(1)}%` : '—')}
          ${metric('Turns', String(totals.turns))}
        </div>
      </div>
      <div class="ctx-card">
        <div class="ctx-section-title">Last Assistant Message</div>
        <div class="ctx-metrics">
          ${metric('Input', fmtTokens(last.inputTokens))}
          ${metric('Output', fmtTokens(last.outputTokens))}
          ${metric('Cache Read', fmtTokens(last.cacheReadTokens))}
          ${metric('Cache Write', fmtTokens(last.cacheWriteTokens))}
          ${metric('Cost', last.costUsd != null ? `$${Number(last.costUsd).toFixed(4)}` : '—')}
          ${metric('Model', last && conversation.model ? shortModel(conversation.model) : '—')}
        </div>
      </div>
      <div class="ctx-card">
        <div class="ctx-bar" style="display:flex;gap:2px;height:6px;overflow:hidden">
          ${shares
            .map((item) => `<span style="width:${item.value.toFixed(1)}%;background:${item.color}"></span>`)
            .join('')}
          <span style="width:${systemShare.toFixed(1)}%;background:#42403e"></span>
        </div>
        <div class="ctx-legend" style="margin-top:8px">
          ${shares
            .map((item) => `<span><i style="background:${item.color}"></i>${item.name} ${Math.round(item.value)}%</span>`)
            .join('')}
          <span><i style="background:#42403e"></i>System &amp; tools ${Math.round(systemShare)}%</span>
        </div>
      </div>
      <div class="ctx-section-title">Raw Messages</div>
      <div class="raw-list">${raw || '<p class="meta">No messages yet.</p>'}</div>
    </div>`;

  els.panelTabs.innerHTML = `<div class="tab active">${icon('chart')}<span>${esc(
    conversation.title || 'Context',
  )}</span></div>`;
  els.panelActions.innerHTML = `<button class="icon-btn" data-expand title="Expand">${icon('expand')}</button><button class="icon-btn" data-close title="Close">${icon(
    'x',
  )}</button>`;
  bindPanelActions();
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const panelMeta = {
  files: {title: 'Files', icon: 'file'},
  git: {title: 'Git', icon: 'git'},
  changes: {title: 'Changed', icon: 'diff'},
  walkthrough: {title: 'Walkthrough', icon: 'map'},
  terminal: {title: 'Terminal', icon: 'terminal'},
  browser: {title: 'Browser', icon: 'globe'},
  knowledge: {title: 'Project knowledge', icon: 'book'},
  context: {title: 'Context', icon: 'chart'},
};

const PLUGIN_ICONS = new Set(['globe', 'folder', 'cloud', 'terminal', 'plug', 'book']);

function pluginById(id) {
  return (state.plugins || []).find((plugin) => plugin.id === id) || null;
}

function pluginPanelIcon(plugin) {
  const name = plugin && plugin.panel && plugin.panel.icon;
  return name && PLUGIN_ICONS.has(name) ? name : 'plug';
}

function renderPluginRail() {
  for (const node of els.rail.querySelectorAll('[data-plugin-rail]')) node.remove();
  const plugins = (state.plugins || [])
    .filter((plugin) => plugin.enabled && plugin.loaded && plugin.panel && plugin.uiUrl)
    .sort((a, b) =>
      String(a.panel.title || a.name).localeCompare(String(b.panel.title || b.name)),
    );
  if (!plugins.length) return;

  const separator = document.createElement('div');
  separator.className = 'rail-sep';
  separator.dataset.pluginRail = '1';
  els.railConfig.before(separator);

  for (const plugin of plugins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.panel = `plugin:${plugin.id}`;
    button.dataset.pluginRail = '1';
    button.title = plugin.panel.title || plugin.name;
    button.innerHTML = icon(pluginPanelIcon(plugin));
    els.railConfig.before(button);
  }
}

function renderPluginPanel(id) {
  const plugin = pluginById(id);
  const title = plugin ? plugin.panel?.title || plugin.name : 'Plugin';

  if (!plugin || !plugin.enabled || !plugin.loaded || !plugin.uiUrl) {
    panelHead(
      `<div class="tab active">${icon(pluginPanelIcon(plugin))}<span>${esc(title)}</span></div>`,
      `<button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
    );
    els.panelBody.innerHTML = `<div class="panel-empty">${icon('plug')}<strong>${esc(
      title,
    )}</strong><span>${esc(plugin?.error || 'The plugin is disabled or has no panel.')}</span></div>`;
    return;
  }

  panelHead(
    `<div class="tab active">${icon(pluginPanelIcon(plugin))}<span>${esc(title)}</span></div>`,
    `<button class="icon-btn" data-plugin-reload title="Reload plugin">${icon(
      'refresh',
    )}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );

  els.panelBody.innerHTML = `<iframe class="plugin-frame" title="${esc(title)}" src="${esc(
    plugin.uiUrl,
  )}${plugin.uiUrl.includes('?') ? '&' : '?'}v=${Date.now()}"></iframe>`;

  const reload = els.panelActions.querySelector('[data-plugin-reload]');
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        await api(`/api/plugins/${encodeURIComponent(id)}/reload`, {method: 'POST', body: '{}'});
        await loadPlugins();
        renderPluginPanel(id);
        toast('Plugin reloaded.');
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

function setRailActive() {
  els.rail.querySelectorAll('button[data-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.panel === state.panel && !els.panel.hidden);
  });
}

function closePanel() {
  els.panel.hidden = true;
  state.panel = null;
  state.panelFile = null;
  els.panelBody.innerHTML = '';
  setRailActive();
}

async function openPanel(name) {
  if (!name) return;
  if (!els.panel.hidden && state.panel === name) {
    closePanel();
    return;
  }
  closeMenus();
  els.sessionPanel.hidden = true;
  els.panel.hidden = false;
  state.panel = name;
  state.panelFile = null;
  els.panelBody.innerHTML = '';
  setRailActive();

  if (name.startsWith('plugin:')) return renderPluginPanel(name.slice('plugin:'.length));
  if (name === 'context') return renderContextPanel();
  await renderPanel(name);
}

function bindPanelActions() {
  const expand = els.panelActions.querySelector('[data-expand]');
  if (expand) expand.addEventListener('click', () => els.panel.classList.toggle('wide'));
  const close = els.panelActions.querySelector('[data-close]');
  if (close) close.addEventListener('click', closePanel);
  const refresh = els.panelActions.querySelector('[data-refresh]');
  if (refresh) refresh.addEventListener('click', () => renderPanel(state.panel, true));
  const copy = els.panelActions.querySelector('[data-copy]');
  if (copy) {
    copy.addEventListener('click', () => {
      const text = els.panelBody.innerText;
      navigator.clipboard && navigator.clipboard.writeText(text);
      toast('Copied.');
    });
  }
}

function panelHead(tabs, actions) {
  els.panelTabs.innerHTML = tabs;
  els.panelActions.innerHTML = actions;
  bindPanelActions();
}

async function renderPanel(name, force = false) {
  if (name.startsWith('plugin:')) return renderPluginPanel(name.slice('plugin:'.length));
  els.panelBody.innerHTML = '<div class="panel-empty">Loading…</div>';
  try {
    if (name === 'files') await renderFiles();
    else if (name === 'git') await renderGit(false);
    else if (name === 'changes') await renderChanges();
    else if (name === 'walkthrough') await renderWalkthrough();
    else if (name === 'terminal') renderTerminal();
    else if (name === 'browser') renderBrowser();
    else if (name === 'knowledge') await renderKnowledge();
  } catch (err) {
    els.panelBody.innerHTML = `<div class="panel-empty">${esc(err.message)}</div>`;
  }
}

// Files ---------------------------------------------------------------------

async function loadDir(dir) {
  const data = await api(
    `/api/files?workspace=${encodeURIComponent(state.workspace)}&path=${encodeURIComponent(dir)}`,
  );
  state.tree.set(dir, data.entries || []);
  return data.entries || [];
}

async function renderFiles() {
  panelHead(
    `<div class="tab active">${icon('file')}<span>Files</span></div>`,
    `<button class="icon-btn" data-refresh title="Refresh">${icon('refresh')}</button><button class="icon-btn" data-copy title="Copy">${icon(
      'copy',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );

  if (state.panelFile) return renderFileView(state.panelFile);

  els.panelBody.innerHTML = `
    <div class="panel-toolbar">
      <label class="field">${icon('search')}<input id="file-search" placeholder="Search files..." /></label>
    </div>
    <div class="tree" id="file-tree"><p class="empty-row">Loading…</p></div>`;

  const search = els.panelBody.querySelector('#file-search');
  search.addEventListener('input', async () => {
    const query = search.value.trim();
    if (!query) return paintTree();
    try {
      const data = await api(
        `/api/search?workspace=${encodeURIComponent(state.workspace)}&q=${encodeURIComponent(query)}`,
      );
      const tree = els.panelBody.querySelector('#file-tree');
      tree.innerHTML = '';
      if (!data.entries.length) {
        tree.innerHTML = '<p class="empty-row">No matching files.</p>';
        return;
      }
      for (const entry of data.entries) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.innerHTML = `<span class="twist"></span>${icon('file')}<span class="label">${esc(
          entry.path.replace(state.workspace, '').replace(/^[\\/]/, ''),
        )}</span>`;
        row.addEventListener('click', () => openFileView(entry.path));
        tree.append(row);
      }
    } catch (err) {
      toast(err.message);
    }
  });

  paintTree();
}

async function paintTree() {
  const host = els.panelBody.querySelector('#file-tree');
  if (!host) return;
  host.innerHTML = '';
  try {
    await loadDir(state.workspace);
  } catch (err) {
    host.innerHTML = `<p class="empty-row">${esc(err.message)}</p>`;
    return;
  }
  await paintDir(host, state.workspace, 0);
}

async function paintDir(host, dir, depth) {
  const entries = (state.tree.get(dir) || []).filter((entry) => !entry.name.startsWith('.'));
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const open = state.treeOpen.has(entry.path);
    row.innerHTML = `<span class="twist">${
      entry.dir ? icon(open ? 'chevron-down' : 'chevron-right') : ''
    }</span>${icon(entry.dir ? 'folder' : 'file')}<span class="label">${esc(entry.name)}</span>`;
    row.addEventListener('click', async () => {
      if (!entry.dir) return openFileView(entry.path);
      if (state.treeOpen.has(entry.path)) state.treeOpen.delete(entry.path);
      else {
        state.treeOpen.add(entry.path);
        try {
          await loadDir(entry.path);
        } catch (err) {
          toast(err.message);
          state.treeOpen.delete(entry.path);
        }
      }
      paintTree();
    });
    host.append(row);

    if (entry.dir && open) {
      if (!state.tree.has(entry.path)) {
        try {
          await loadDir(entry.path);
        } catch {
          /* unreadable folder: leave it closed */
        }
      }
      await paintDir(host, entry.path, depth + 1);
    }
  }
}

async function openFileView(path) {
  try {
    const data = await api(
      `/api/file?workspace=${encodeURIComponent(state.workspace)}&path=${encodeURIComponent(path)}`,
    );
    state.panelFile = {path: data.path, text: data.text, binary: data.binary, truncated: data.truncated, size: data.size};
    renderFileView(state.panelFile);
  } catch (err) {
    toast(err.message);
  }
}

function renderFileView(file) {
  const relative = file.path.replace(state.workspace, '').replace(/^[\\/]/, '');
  panelHead(
    `<div class="tab active">${icon('file')}<span>${esc(relative)}</span></div>`,
    `<button class="icon-btn" data-back title="Back">${icon('chevron-right')}</button><button class="icon-btn" data-copy title="Copy">${icon(
      'copy',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  els.panelActions.querySelector('[data-back]').addEventListener('click', () => {
    state.panelFile = null;
    renderFiles();
  });
  els.panelBody.innerHTML = `<div class="file-view"><div class="file-view-head"><span class="path">${esc(
    relative,
  )}</span><span>${fmtTokens(file.size)}B${file.truncated ? ' · truncated' : ''}</span></div><pre></pre></div>`;
  const pre = els.panelBody.querySelector('pre');
  pre.textContent = file.binary ? 'Binary file — not shown.' : file.text || '';
}

// Git -----------------------------------------------------------------------

async function fetchGit(force = false) {
  if (!state.git || force || state.git.workspace !== state.workspace) {
    state.git = await api(`/api/git?workspace=${encodeURIComponent(state.workspace)}`);
    state.git.workspace = state.workspace;
  }
  return state.git;
}

async function renderGit(force) {
  panelHead(
    `<div class="tab active">${icon('git')}<span>Git</span></div>`,
    `<button class="icon-btn" data-refresh title="Refresh">${icon('refresh')}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  const data = await fetchGit(force);
  if (!data.isRepo) {
    els.panelBody.innerHTML = `
      <div class="panel-empty">${icon('git')}<strong>This directory is not a Git repository</strong>
        <span>Initialize Git in this directory or open a repository.</span>
        <button class="btn primary" data-init type="button">Initialize Git</button>
      </div>`;
    els.panelBody.querySelector('[data-init]').addEventListener('click', async () => {
      try {
        const result = await api('/api/git/init', {method: 'POST', body: JSON.stringify({workspace: state.workspace})});
        toast(result.ok ? 'Git repository initialized.' : result.output || 'Git init failed.');
        state.git = null;
        renderGit(true);
      } catch (err) {
        toast(err.message);
      }
    });
    return;
  }
  const files = data.files || [];
  els.panelBody.innerHTML = `
    <div class="git-head">${icon('git')}<span class="branch">${esc(data.branch || 'HEAD')}</span><span class="spacer"></span><span>${
      files.length
    } changed</span></div>
    <div class="git-list">${
      files.length
        ? files
            .map(
              (file) =>
                `<button class="change" type="button" data-path="${esc(file.path)}"><span class="badge ${esc(
                  file.status[0],
                )}">${esc(file.status[0])}</span><span class="path">${esc(file.path)}</span></button>`,
            )
            .join('')
        : '<p class="empty-row">Working tree clean.</p>'
    }</div>`;
  els.panelBody.querySelectorAll('.change').forEach((button) => {
    button.addEventListener('click', () => {
      state.gitFile = button.dataset.path;
      openPanel('changes');
    });
  });
}

async function renderChanges() {
  panelHead(
    `<div class="tab active">${icon('diff')}<span id="changed-label">Changed</span></div>`,
    `<button class="icon-btn" data-refresh title="Refresh">${icon('refresh')}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  const data = await fetchGit(true);
  if (!data.isRepo) {
    els.panelBody.innerHTML = `<div class="panel-empty">${icon('diff')}<span>Not a git repository. Use the Git tab to initialize or change directories.</span></div>`;
    return;
  }
  const files = data.files || [];
  const label = els.panelTabs.querySelector('#changed-label');
  if (label) label.textContent = `Changed: ${files.length}`;

  els.panelBody.innerHTML = `
    <div class="git-list">${
      files.length
        ? files
            .map(
              (file) =>
                `<button class="change${
                  state.gitFile === file.path ? ' active' : ''
                }" type="button" data-path="${esc(file.path)}"><span class="badge ${esc(file.status[0])}">${esc(
                  file.status[0],
                )}</span><span class="path">${esc(file.path)}</span></button>`,
            )
            .join('')
        : '<p class="empty-row">Working tree clean.</p>'
    }</div>
    <pre class="diff" id="diff-view">${state.gitFile ? 'Loading diff…' : 'Select a changed file to see its diff.'}</pre>`;

  els.panelBody.querySelectorAll('.change').forEach((button) => {
    button.addEventListener('click', () => {
      state.gitFile = button.dataset.path;
      els.panelBody.querySelectorAll('.change').forEach((item) => item.classList.toggle('active', item === button));
      loadDiff(button.dataset.path);
    });
  });

  if (state.gitFile) loadDiff(state.gitFile);
}

function colorizeDiff(text) {
  return esc(text)
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return line;
      if (line.startsWith('@@')) return `<span class="hunk">${line}</span>`;
      if (line.startsWith('+')) return `<span class="add">${line}</span>`;
      if (line.startsWith('-')) return `<span class="del">${line}</span>`;
      return line;
    })
    .join('\n');
}

async function loadDiff(path) {
  const view = els.panelBody.querySelector('#diff-view');
  if (!view) return;
  try {
    const data = await api(
      `/api/diff?workspace=${encodeURIComponent(state.workspace)}&path=${encodeURIComponent(path)}`,
    );
    view.innerHTML = colorizeDiff(data.diff || 'No diff.');
  } catch (err) {
    view.textContent = err.message;
  }
}

// Walkthrough ---------------------------------------------------------------

async function renderWalkthrough() {
  panelHead(
    `<div class="tab active">${icon('map')}<span>Walkthrough</span></div>`,
    `<button class="icon-btn" data-refresh title="Refresh">${icon('refresh')}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  const data = await api(`/api/walkthrough?workspace=${encodeURIComponent(state.workspace)}`);
  if (!data.commits || !data.commits.length) {
    els.panelBody.innerHTML = `<div class="panel-empty">${icon('git')}<strong>No commits yet</strong><span>Commit some work and its history will appear here.</span></div>`;
    return;
  }
  els.panelBody.innerHTML = `<div class="git-list">${data.commits
    .map(
      (commit) =>
        `<div class="change" style="height:auto;padding:8px;align-items:flex-start;gap:10px"><span class="badge M">${esc(
          commit.hash.slice(0, 4),
        )}</span><span class="path" style="white-space:normal"><b style="color:var(--fg);font-weight:500">${esc(
          commit.subject,
        )}</b><br><span class="meta">${esc(commit.date)} · ${esc(commit.hash)}</span></span></div>`,
    )
    .join('')}</div>`;
}

// Terminal ------------------------------------------------------------------

function renderTerminal() {
  panelHead(
    `<div class="tab active">${icon('terminal')}<span>Terminal</span></div>`,
    `<button class="icon-btn" data-clear title="Clear">${icon('trash')}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  els.panelActions.querySelector('[data-clear]').addEventListener('click', () => {
    state.term.lines = [];
    renderTerminalBody();
  });

  els.panelBody.innerHTML = `
    <div class="term">
      <div class="term-body" id="term-body"></div>
      <div class="term-input"><span>$</span><input id="term-cmd" autocomplete="off" spellcheck="false" placeholder="Run a command in ${esc(
        baseName(state.workspace),
      )}" /></div>
    </div>`;
  renderTerminalBody();

  const input = els.panelBody.querySelector('#term-cmd');
  input.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const command = input.value.trim();
    if (!command || state.term.busy) return;
    input.value = '';
    state.term.busy = true;
    state.term.lines.push({cmd: command});
    renderTerminalBody();
    try {
      const result = await api('/api/exec', {
        method: 'POST',
        body: JSON.stringify({workspace: state.workspace, command}),
      });
      state.term.lines.push({output: result.output || '(no output)', code: result.code});
    } catch (err) {
      state.term.lines.push({error: err.message});
    } finally {
      state.term.busy = false;
      renderTerminalBody();
      const next = els.panelBody.querySelector('#term-cmd');
      if (next) next.focus();
    }
  });
}

function renderTerminalBody() {
  const body = els.panelBody.querySelector('#term-body');
  if (!body) return;
  body.innerHTML = state.term.lines
    .map((line) => {
      if (line.cmd) return `<div><span class="cmd">$ ${esc(line.cmd)}</span></div>`;
      if (line.error) return `<div class="err">${esc(line.error)}</div>`;
      return `<div>${esc(line.output || '')}</div>`;
    })
    .join('');
  body.scrollTop = body.scrollHeight;
}

// Browser -------------------------------------------------------------------

function renderBrowser() {
  panelHead(
    `<div class="tab active">${icon('globe')}<span>Browser</span></div>`,
    `<button class="icon-btn" data-expand title="Expand">${icon('expand')}</button><button class="icon-btn" data-close title="Close">${icon(
      'x',
    )}</button>`,
  );
  els.panelBody.innerHTML = `
    <div class="browser">
      <div class="browser-bar">
        <label class="field">${icon('globe')}<input id="browser-url" placeholder="http://127.0.0.1:3000" value="${esc(
          state.browserUrl,
        )}" /></label>
        <button class="btn" data-go type="button">Open</button>
      </div>
      ${
        state.browserUrl
          ? `<iframe id="browser-frame" src="${esc(state.browserUrl)}" referrerpolicy="no-referrer"></iframe>`
          : '<div class="panel-empty">' +
            icon('globe') +
            '<strong>Open a local address</strong><span>Preview a dev server running on this machine.</span></div>'
      }
    </div>`;
  const input = els.panelBody.querySelector('#browser-url');
  const go = () => {
    const value = input.value.trim();
    if (!value) return;
    state.browserUrl = /^https?:\/\//i.test(value) ? value : `http://${value}`;
    renderBrowser();
  };
  els.panelBody.querySelector('[data-go]').addEventListener('click', go);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go();
  });
}

// Knowledge -----------------------------------------------------------------

async function renderKnowledge() {
  const counts = {notes: 0, todo: 0, plans: 0};
  for (const note of state.notes) counts[note.tab] = (counts[note.tab] || 0) + 1;
  panelHead(
    `<button class="tab${state.notesTab === 'notes' ? ' active' : ''}" data-tab="notes" type="button">${icon(
      'note',
    )}<span>Notes ${counts.notes}</span></button>
     <button class="tab${state.notesTab === 'todo' ? ' active' : ''}" data-tab="todo" type="button">${icon(
       'check',
     )}<span>Todo ${counts.todo}</span></button>
     <button class="tab${state.notesTab === 'plans' ? ' active' : ''}" data-tab="plans" type="button">${icon(
       'map',
     )}<span>Plans ${counts.plans}</span></button>`,
    `<button class="icon-btn" data-refresh title="Refresh">${icon('refresh')}</button><button class="icon-btn" data-expand title="Expand">${icon(
      'expand',
    )}</button><button class="icon-btn" data-close title="Close">${icon('x')}</button>`,
  );
  els.panelTabs.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.notesTab = button.dataset.tab;
      renderKnowledge();
    });
  });

  const items = state.notes.filter((note) => note.tab === state.notesTab);
  const placeholder =
    state.notesTab === 'todo' ? 'Add a todo…' : state.notesTab === 'plans' ? 'Add a plan…' : 'Capture context, reminders, or links';

  els.panelBody.innerHTML = `
    <div class="knowledge">
      <div class="composer-row"><input id="note-input" placeholder="${esc(placeholder)}" /><button class="btn" data-add type="button">${icon(
        'plus',
      )}</button></div>
      <div id="note-list"></div>
    </div>`;
  const list = els.panelBody.querySelector('#note-list');
  for (const note of items) {
    const item = document.createElement('div');
    item.className = `item${note.done ? ' done' : ''}`;
    item.innerHTML = `${
      state.notesTab === 'todo'
        ? `<button class="check${note.done ? ' done' : ''}" data-toggle type="button">${icon('check')}</button>`
        : icon('file')
    }<span class="text">${esc(note.text)}</span><button class="icon-btn" data-del type="button" title="Delete">${icon(
      'trash',
    )}</button>`;
    item.querySelector('[data-del]').addEventListener('click', async () => {
      await api(`/api/notes/${note.id}`, {method: 'DELETE'}).catch((err) => toast(err.message));
      await loadNotes();
      renderKnowledge();
    });
    const toggle = item.querySelector('[data-toggle]');
    if (toggle) {
      toggle.addEventListener('click', async () => {
        await api(`/api/notes/${note.id}`, {
          method: 'PATCH',
          body: JSON.stringify({done: !note.done}),
        }).catch((err) => toast(err.message));
        await loadNotes();
        renderKnowledge();
      });
    }
    list.append(item);
  }
  if (!items.length) {
    list.innerHTML = '<p class="empty-row">Nothing here yet.</p>';
  }

  const input = els.panelBody.querySelector('#note-input');
  const add = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await api('/api/notes', {
        method: 'POST',
        body: JSON.stringify({workspace: state.workspace, tab: state.notesTab, text}),
      });
      input.value = '';
      await loadNotes();
      renderKnowledge();
    } catch (err) {
      toast(err.message);
    }
  };
  els.panelBody.querySelector('[data-add]').addEventListener('click', add);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });
}

// ---------------------------------------------------------------------------
// Composer controls
// ---------------------------------------------------------------------------

function setModelLabel(model) {
  if (!model) {
    els.modelLabel.textContent = 'Command Code / default';
    return;
  }
  const suffix = state.model ? (state.model === model ? 'selected' : 'active') : 'default';
  els.modelLabel.textContent = `${shortModel(model)} / ${suffix}`;
}

function modeLabel() {
  if (state.agent === 'plan') return 'Plan';
  if (state.permission === 'full') return 'Full access';
  if (state.permission === 'accept') return 'Accept edits';
  return 'Read-only';
}

function refreshComposerState() {
  els.permissions.classList.toggle('on', state.permission === 'full');
  els.permissions.title = `Permissions: ${modeLabel()}`;
  els.agentLabel.textContent = state.agent === 'plan' ? 'Plan' : 'Build';
  els.agentBtn.querySelector('.agent-dot').style.background = state.agent === 'plan' ? 'var(--muted)' : 'var(--success)';
  setModelLabel(state.model || '');
}

function permissionMenu() {
  floatingMenu(
    els.permissions,
    (menu) => {
      menu.append(
        menuItem('Read-only', {
          iconName: 'eye',
          active: state.permission === 'read-only',
          hint: 'explain and search',
          onClick: () => {
            state.permission = 'read-only';
            localStorage.setItem('thechambers-permission', state.permission);
            refreshComposerState();
          },
        }),
        menuItem('Accept edits', {
          iconName: 'edit',
          active: state.permission === 'accept',
          hint: 'apply file edits',
          onClick: () => {
            state.permission = 'accept';
            localStorage.setItem('thechambers-permission', state.permission);
            refreshComposerState();
          },
        }),
        menuItem('Full access', {
          iconName: 'shield',
          active: state.permission === 'full',
          hint: '--yolo',
          onClick: () => {
            state.permission = 'full';
            localStorage.setItem('thechambers-permission', state.permission);
            refreshComposerState();
          },
        }),
      );
    },
    {width: 240},
  );
}

function agentMenu() {
  floatingMenu(
    els.agentBtn,
    (menu) => {
      menu.append(
        menuItem('Build', {
          iconName: 'spark',
          active: state.agent === 'build',
          hint: modeLabel(),
          onClick: () => {
            state.agent = 'build';
            localStorage.setItem('thechambers-agent', 'build');
            refreshComposerState();
          },
        }),
        menuItem('Plan', {
          iconName: 'map',
          active: state.agent === 'plan',
          hint: 'read-only planning',
          onClick: () => {
            state.agent = 'plan';
            localStorage.setItem('thechambers-agent', 'plan');
            refreshComposerState();
          },
        }),
        menuSep(),
        menuTitle('Permission'),
        menuItem('Read-only', {iconName: 'eye', active: state.permission === 'read-only', onClick: () => {
          state.permission = 'read-only';
          localStorage.setItem('thechambers-permission', state.permission);
          refreshComposerState();
        }}),
        menuItem('Accept edits', {iconName: 'edit', active: state.permission === 'accept', onClick: () => {
          state.permission = 'accept';
          localStorage.setItem('thechambers-permission', state.permission);
          refreshComposerState();
        }}),
        menuItem('Full access', {iconName: 'shield', active: state.permission === 'full', onClick: () => {
          state.permission = 'full';
          localStorage.setItem('thechambers-permission', state.permission);
          refreshComposerState();
        }}),
      );
    },
    {width: 260},
  );
}

async function modelMenu() {
  let data = state.models;
  const menu = floatingMenu(
    els.modelBtn,
    (node) => {
      const search = document.createElement('div');
      search.className = 'menu-search';
      search.innerHTML = `${icon('search')}<input placeholder="Search models" />`;
      node.append(search);
      node.append(menuItem('Default', {iconName: 'cpu', active: !state.model, hint: 'auto', onClick: () => {
        state.model = '';
        localStorage.removeItem('thechambers-model');
        refreshComposerState();
      }}));
      const list = document.createElement('div');
      list.className = 'menu-list scroll';
      node.append(list);
      const paint = (query = '') => {
        list.innerHTML = '';
        if (!data) {
          list.innerHTML = '<p class="empty-row">Loading models…</p>';
          return;
        }
        const needle = query.toLowerCase();
        for (const group of data.groups || []) {
          const models = group.models.filter(
            (model) => !needle || model.id.toLowerCase().includes(needle) || (model.note || '').toLowerCase().includes(needle),
          );
          if (!models.length) continue;
          list.append(menuTitle(group.name));
          for (const model of models) {
            list.append(
              menuItem(shortModel(model.id), {
                iconName: 'cpu',
                active: state.model === model.id,
                hint: model.note ? model.note.split(' ').slice(0, 3).join(' ') : '',
                onClick: () => {
                  state.model = model.id;
                  localStorage.setItem('thechambers-model', model.id);
                  refreshComposerState();
                },
              }),
            );
          }
        }
      };
      paint();
      const input = search.querySelector('input');
      input.addEventListener('input', () => paint(input.value.trim()));
      setTimeout(() => input.focus(), 0);
    },
    {width: 340},
  );
  menu.style.maxHeight = '60vh';
  menu.style.overflowY = 'auto';

  if (!data) {
    try {
      state.models = await api('/api/models');
      closeMenus();
      modelMenu();
    } catch {
      state.models = {groups: [], defaultModel: null};
    }
  }
}

function goalToggle() {
  state.goal = !state.goal;
  els.goal.classList.toggle('on', state.goal);
  if (state.goal && !els.input.value.trim()) {
    els.input.value = 'Goal: ';
    autoGrow();
    updateSendState();
    els.input.focus();
  }
}

// Concise mode: a per-conversation instruction that targets verbosity and repeated work. Off by
// default, because a terse instruction makes verification-heavy coding worse.
function applyConciseState() {
  els.concise.classList.toggle('on', state.concise);
  els.concise.title = state.concise
    ? 'Concise mode on — fewer words, less repeated work'
    : 'Concise mode — fewer words, less repeated work';
}

function conciseToggle() {
  state.concise = !state.concise;
  localStorage.setItem('thechambers-concise', state.concise ? '1' : '0');
  applyConciseState();
  toast(state.concise ? 'Concise mode on for this conversation.' : 'Concise mode off.');
}

// Screenshots and files: uploaded once, then referenced by path. Command Code reads the files
// with its own tools, so the prompt only has to say where they are.
function renderAttachments() {
  const items = state.attachments;
  els.attachments.hidden = !items.length;
  els.attachments.innerHTML = items
    .map(
      (item, index) => `
      <div class="attach" title="${esc(item.path)}">
        ${
          item.image
            ? `<img src="${esc(item.url)}" alt="" loading="lazy" />`
            : `<span class="attach-glyph">${icon('file')}</span>`
        }
        <span class="attach-name">${esc(item.name)}</span>
        <button type="button" class="attach-x" data-remove-attach="${index}" aria-label="Remove attachment">${icon('x')}</button>
      </div>`,
    )
    .join('');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// Images are the most expensive thing you can paste. Downscale to 1024px / JPEG 0.8 before upload;
// a phone screenshot typically drops by more than half, without hurting legibility.
async function prepareImage(file, max = 1024, quality = 0.8) {
  if (!/^image\//.test(file.type || '') || /gif|svg/i.test(file.type || '')) {
    return {file, resized: false};
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= max) return {file, resized: false};
    const scale = max / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return {file, resized: false};
    const name = file.name.replace(/\.(png|webp|bmp|heic)$/i, '.jpg');
    return {file: new File([blob], name, {type: 'image/jpeg'}), resized: true, original: file.size, size: blob.size};
  } catch {
    return {file, resized: false};
  }
}

async function uploadFiles(fileList) {
  const files = [...(fileList || [])];
  for (const original of files) {
    const prepared = await prepareImage(original);
    const file = prepared.file;
    if (file.size > 12 * 1024 * 1024) {
      toast(`${file.name} is over the 12 MB limit.`);
      continue;
    }
    try {
      const data = await fileToBase64(file);
      const result = await api('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({name: file.name, data}),
      });
      state.attachments.push({...result, image: /^image\//.test(file.type || '')});
      renderAttachments();
      if (prepared.resized) {
        const saved = Math.max(0, Math.round((1 - file.size / prepared.original) * 100));
        toast(`Resized to 1024px — ${saved}% smaller.`);
      }
    } catch (err) {
      toast(err.message);
    }
  }
  updateSendState();
}

els.attachments.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-attach]');
  if (!button) return;
  state.attachments.splice(Number(button.dataset.removeAttach), 1);
  renderAttachments();
  updateSendState();
});

function attachFiles() {
  els.fileInput.click();
}

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, window.innerHeight * 0.4)}px`;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

let updateSettings = {autoCheckUpdates: true, autoUpdate: false};
let lastUpdateCheck = 0;

async function loadSettings() {
  try {
    updateSettings = {...updateSettings, ...(await api('/api/settings'))};
  } catch {
    /* keep the defaults; the update pane still works */
  }
}

function paintUpdateDot(status) {
  const available = Boolean(status && status.updateAvailable);
  els.updateDot.hidden = !available;
  els.updates.title = available ? 'Update available' : 'Updates';
  els.updates.classList.toggle('available', available);
}

async function checkUpdates({force = false, silent = false} = {}) {
  try {
    lastUpdateCheck = Date.now();
    const status = await api(`/api/update${force ? '?force=1' : ''}`);
    state.update = status;
    paintUpdateDot(status);
    if (status.updateAvailable) {
      if (!silent) toast(`Update available: ${status.latest.short}`);
      if (updateSettings.autoUpdate && status.canApply) return applyUpdate({auto: true});
    }
    return status;
  } catch (err) {
    if (!silent) toast(err.message);
    return null;
  }
}

async function applyUpdate({auto = false} = {}) {
  try {
    const result = await api('/api/update/apply', {method: 'POST', body: '{}'});
    state.update = {...(state.update || {}), ...result, updateAvailable: false};
    paintUpdateDot(null);
    if (result.restartRequired) {
      toast('Update downloaded. Restart the server to run the new server code.');
    } else {
      toast(auto ? 'Update downloaded — reloading.' : 'Update downloaded — reloading.');
      setTimeout(() => location.reload(), 1200);
    }
    return result;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

function openUpdates() {
  const status = state.update;
  const current = (status && status.current) || {};
  const latest = status && status.latest;
  const repo = (status && status.repo) || 'shawnradam/TheChambers';

  openModal({
    title: 'Updates',
    width: 560,
    content: `
      <div class="kv"><span>Repository</span><b>${esc(repo)}</b></div>
      <div class="kv"><span>Current</span><b>${esc(state.health ? state.health.commit || '—' : '—')}${current.dirty ? ' · uncommitted changes' : ''}</b></div>
      <div class="kv"><span>Latest on GitHub</span><b>${esc(latest ? latest.short : '—')}</b></div>
      <div class="kv"><span>Status</span><b>${status && status.updateAvailable ? 'Update available' : status && status.error ? esc(status.error) : 'Up to date'}</b></div>
      ${latest && latest.url ? `<p class="meta"><a href="${esc(latest.url)}" target="_blank" rel="noreferrer noopener">See what changed on GitHub</a></p>` : ''}
      <label class="check"><input type="checkbox" id="auto-check" ${updateSettings.autoCheckUpdates ? 'checked' : ''} /> Check for updates on start</label>
      <label class="check"><input type="checkbox" id="auto-update" ${updateSettings.autoUpdate ? 'checked' : ''} /> Download new updates automatically</label>
      <div class="actions">
        <button class="btn" data-check type="button">Check now</button>
        <button class="btn primary" data-apply type="button" ${status && status.canApply ? '' : 'disabled'}>
          ${status && status.updateAvailable ? 'Download update' : 'Nothing to download'}
        </button>
      </div>`,
    onOpen: ({body, close}) => {
      const save = (changes) =>
        api('/api/settings', {method: 'POST', body: JSON.stringify(changes)})
          .then((next) => {
            updateSettings = {...updateSettings, ...next};
          })
          .catch((err) => toast(err.message));

      body.querySelector('#auto-check').addEventListener('change', (event) => {
        save({autoCheckUpdates: event.target.checked});
      });
      body.querySelector('#auto-update').addEventListener('change', (event) => {
        save({autoUpdate: event.target.checked});
      });
      body.querySelector('[data-check]').addEventListener('click', async () => {
        const next = await checkUpdates({force: true});
        close();
        if (next) openUpdates();
      });
      body.querySelector('[data-apply]').addEventListener('click', async () => {
        const result = await applyUpdate();
        if (result) close();
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Settings, shortcuts, misc
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugin manager
// ---------------------------------------------------------------------------

function pluginCardHtml(plugin) {
  const status = plugin.error
    ? '<span class="plugin-status bad">Failed</span>'
    : plugin.enabled
      ? plugin.loaded
        ? '<span class="plugin-status ok">Enabled</span>'
        : '<span class="plugin-status bad">Not loaded</span>'
      : '<span class="plugin-status">Disabled</span>';
  const permissions =
    plugin.permissions && plugin.permissions.length
      ? ` · ${esc(plugin.permissions.join(', '))}`
      : '';

  return `<div class="plugin-card" data-plugin-card="${esc(plugin.id)}">
    <div class="plugin-card-head">
      <div class="plugin-title">
        <span class="plugin-name">${esc(plugin.name)}</span>
        <span class="plugin-version">v${esc(plugin.version)}</span>
        <span class="plugin-source">${esc(plugin.source)}</span>
      </div>
      <label class="plugin-toggle"><input type="checkbox" data-plugin-enable ${
        plugin.enabled ? 'checked' : ''
      } /> <span>Enabled</span></label>
    </div>
    <p class="plugin-desc">${esc(plugin.description || 'No description.')}</p>
    <div class="plugin-meta"><code>${esc(plugin.id)}</code>${permissions}<span class="spacer"></span>${status}</div>
    ${plugin.error ? `<div class="plugin-error">${esc(plugin.error)}</div>` : ''}
    <div class="plugin-card-actions">
      ${
        plugin.enabled && plugin.loaded && plugin.uiUrl
          ? '<button class="btn" data-plugin-open type="button">Open panel</button>'
          : ''
      }
      <button class="btn" data-plugin-reload type="button">Reload</button>
      ${
        plugin.hasPackage
          ? '<button class="btn" data-plugin-deps type="button">Install dependencies</button>'
          : ''
      }
      <button class="btn" data-plugin-copy type="button">Copy path</button>
      ${
        plugin.source === 'user'
          ? '<button class="btn danger" data-plugin-remove type="button">Remove</button>'
          : ''
      }
    </div>
  </div>`;
}

async function applyPluginEnabled(plugin, enabled, rerender, trust = false) {
  try {
    await api(`/api/plugins/${encodeURIComponent(plugin.id)}/enable`, {
      method: 'POST',
      body: JSON.stringify({enabled, ...(trust ? {trust: true} : {})}),
    });
    await loadPlugins();
    const current = pluginById(plugin.id);
    if (enabled && current && current.error) toast(current.error);
    await rerender();
  } catch (err) {
    toast(err.message);
    await rerender();
  }
}

function confirmPluginEnable(plugin, onConfirm) {
  openModal({
    title: `Enable ${plugin.name}?`,
    width: 480,
    content: `
      <p>This plugin runs Node.js code in the TheChambers process. It can read files, use the
      network, and start processes on this machine.</p>
      <div class="kv"><span>Source</span><b>${esc(plugin.source)}</b></div>
      <div class="kv"><span>Folder</span><b>${esc(plugin.dir)}</b></div>
      <div class="kv"><span>Permissions</span><b>${esc(
        plugin.permissions && plugin.permissions.length ? plugin.permissions.join(', ') : 'not declared',
      )}</b></div>
      <p class="plugin-warning">Only enable a plugin whose code you trust. There is no sandbox.</p>
      <div class="actions">
        <button class="btn" data-cancel type="button">Cancel</button>
        <button class="btn primary" data-enable type="button">Enable plugin</button>
      </div>`,
    onOpen: ({body, close}) => {
      body.querySelector('[data-cancel]').addEventListener('click', close);
      body.querySelector('[data-enable]').addEventListener('click', () => {
        close();
        onConfirm();
      });
    },
  });
}

function confirmPluginRemove(plugin, onDone) {
  openModal({
    title: `Remove ${plugin.name}?`,
    width: 460,
    content: `
      <p>The plugin folder is moved to <code>plugins/.trash</code> and kept for 30 days. Its
      configuration stays in <code>plugin-data/${esc(plugin.id)}</code>.</p>
      <div class="actions">
        <button class="btn" data-cancel type="button">Cancel</button>
        <button class="btn danger" data-remove type="button">Remove plugin</button>
      </div>`,
    onOpen: ({body, close}) => {
      body.querySelector('[data-cancel]').addEventListener('click', close);
      body.querySelector('[data-remove]').addEventListener('click', async () => {
        close();
        try {
          await api(`/api/plugins/${encodeURIComponent(plugin.id)}`, {method: 'DELETE'});
          toast('Plugin moved to .trash.');
          await onDone();
        } catch (err) {
          toast(err.message);
          await onDone();
        }
      });
    },
  });
}

function openPluginCreate(onDone) {
  openModal({
    title: 'Create plugin',
    width: 520,
    content: `
      <label class="label">Plugin id</label>
      <input class="text" id="plugin-id" placeholder="my-plugin" autocomplete="off" />
      <label class="label">Name</label>
      <input class="text" id="plugin-name" placeholder="My plugin" autocomplete="off" />
      <label class="label">Description</label>
      <input class="text" id="plugin-desc" placeholder="What it does" autocomplete="off" />
      <label class="check"><input type="checkbox" id="plugin-ui" checked /> Include a starter UI</label>
      <label class="check"><input type="checkbox" id="plugin-panel" checked /> Add a panel to the rail</label>
      <div class="actions">
        <button class="btn" data-cancel type="button">Cancel</button>
        <button class="btn primary" data-create type="button">Create plugin</button>
      </div>`,
    onOpen: ({body, close}) => {
      body.querySelector('[data-cancel]').addEventListener('click', close);
      body.querySelector('[data-create]').addEventListener('click', async () => {
        const id = body.querySelector('#plugin-id').value.trim().toLowerCase();
        if (!id) {
          toast('Give the plugin an id.');
          return;
        }
        try {
          const data = await api('/api/plugins/create', {
            method: 'POST',
            body: JSON.stringify({
              id,
              name: body.querySelector('#plugin-name').value.trim() || id,
              description: body.querySelector('#plugin-desc').value.trim(),
              ui: body.querySelector('#plugin-ui').checked,
              panel: body.querySelector('#plugin-panel').checked,
            }),
          });
          close();
          toast(`Created ${data.path || id}. Edit it, then Reload.`);
          await onDone();
        } catch (err) {
          toast(err.message);
        }
      });
    },
  });
}

async function renderPluginManager(pane, close) {
  pane.innerHTML = '<div class="panel-empty">Loading plugins…</div>';
  await loadPlugins();
  const plugins = state.plugins || [];
  const rerender = () => renderPluginManager(pane, close);

  pane.innerHTML = `
    <h3>Plugins</h3>
    <p class="plugin-warning">Plugins run Node.js code on this machine with the same access as
    TheChambers. Only enable code you trust. There is no sandbox.</p>
    <div class="plugin-toolbar">
      <button class="btn primary" data-plugin-create type="button">Create plugin…</button>
      <button class="btn" data-plugin-install type="button">Install from folder…</button>
      <button class="btn" data-plugin-refresh type="button">Refresh</button>
    </div>
    <div class="plugin-list">${
      plugins.length
        ? plugins.map(pluginCardHtml).join('')
        : '<p class="empty-row">No plugins yet. Create one or install a folder.</p>'
    }</div>
    <p class="plugin-root">Plugin folder: <code>${esc(state.pluginRoot || '')}</code></p>`;

  pane.querySelector('[data-plugin-create]').addEventListener('click', () => openPluginCreate(rerender));
  pane.querySelector('[data-plugin-install]').addEventListener('click', () =>
    openPrompt({
      title: 'Install plugin',
      label: 'Folder containing plugin.json',
      placeholder: 'C:\\path\\to\\plugin',
      confirm: 'Install',
      onConfirm: async (path) => {
        try {
          await api('/api/plugins/install', {method: 'POST', body: JSON.stringify({path})});
          toast('Plugin installed.');
          await rerender();
        } catch (err) {
          toast(err.message);
        }
      },
    }),
  );
  pane.querySelector('[data-plugin-refresh]').addEventListener('click', async () => {
    try {
      await api('/api/plugins/refresh', {method: 'POST', body: '{}'});
      await rerender();
    } catch (err) {
      toast(err.message);
    }
  });

  for (const plugin of plugins) {
    const card = pane.querySelector(`[data-plugin-card="${plugin.id}"]`);
    if (!card) continue;

    const toggle = card.querySelector('[data-plugin-enable]');
    if (toggle) {
      toggle.addEventListener('change', async (event) => {
        const want = event.target.checked;
        if (want && !plugin.trusted) {
          event.target.checked = false;
          confirmPluginEnable(plugin, () => applyPluginEnabled(plugin, true, rerender, true));
          return;
        }
        toggle.disabled = true;
        await applyPluginEnabled(plugin, want, rerender);
      });
    }

    const open = card.querySelector('[data-plugin-open]');
    if (open) {
      open.addEventListener('click', () => {
        close();
        openPanel(`plugin:${plugin.id}`);
      });
    }

    const reload = card.querySelector('[data-plugin-reload]');
    if (reload) {
      reload.addEventListener('click', async () => {
        try {
          await api(`/api/plugins/${encodeURIComponent(plugin.id)}/reload`, {
            method: 'POST',
            body: '{}',
          });
          toast('Plugin reloaded.');
          await rerender();
        } catch (err) {
          toast(err.message);
        }
      });
    }

    const deps = card.querySelector('[data-plugin-deps]');
    if (deps) {
      deps.addEventListener('click', async () => {
        deps.disabled = true;
        toast('Installing dependencies…');
        try {
          const data = await api(`/api/plugins/${encodeURIComponent(plugin.id)}/deps`, {
            method: 'POST',
            body: '{}',
          });
          const lines = String(data.output || '').trim().split('\n');
          toast(lines[lines.length - 1] || 'Dependencies installed.');
          await rerender();
        } catch (err) {
          toast(err.message);
          await rerender();
        }
      });
    }

    const copy = card.querySelector('[data-plugin-copy]');
    if (copy) {
      copy.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(plugin.dir);
        toast('Path copied.');
      });
    }

    const remove = card.querySelector('[data-plugin-remove]');
    if (remove) {
      remove.addEventListener('click', () => confirmPluginRemove(plugin, rerender));
    }
  }
}

function openSettings() {
  openModal({
    title: 'Settings',
    width: 720,
    content: `
      <div class="settings-layout">
        <div class="settings-nav">
          <label class="field settings-search">${icon('search')}<input placeholder="Search settings" /></label>
          <button class="menu-item active" data-pane="general" type="button">${icon('gear')}General</button>
          <button class="menu-item" data-pane="updates" type="button">${icon('refresh')}Updates</button>
          <button class="menu-item" data-pane="projects" type="button">${icon('folder')}Projects</button>
          <button class="menu-item" data-pane="plugins" type="button">${icon('plug')}Plugins</button>
          <button class="menu-item" data-pane="about" type="button">${icon('book')}About</button>
        </div>
        <div id="settings-pane" class="settings-pane"></div>
      </div>`,
    onOpen: ({body, close}) => {
      const pane = body.querySelector('#settings-pane');
      const paint = (name) => {
        body.querySelectorAll('[data-pane]').forEach((button) => {
          button.classList.toggle('active', button.dataset.pane === name);
        });
        if (name === 'plugins') {
          renderPluginManager(pane, close);
        } else if (name === 'projects') {
          pane.innerHTML = `<h3>Projects</h3><p>Folders Command Code already has sessions for, plus any folder you add.</p>${state.projects
            .map(
              (project) =>
                `<div class="kv"><span>${esc(project.name)}</span><b>${esc(project.path)}</b></div>`,
            )
            .join('')}<div class="actions"><button class="btn" data-add-project type="button">Add project</button></div>`;
          pane.querySelector('[data-add-project]').addEventListener('click', () => {
            close();
            promptForProject();
          });
        } else if (name === 'updates') {
          const status = state.update;
          const current = (status && status.current) || {};
          const latest = status && status.latest;
          pane.innerHTML = `
            <h3>Updates</h3>
            <p>TheChambers pulls new commits from GitHub. Local changes are never overwritten: if the
            tree is dirty, the update stops and tells you.</p>
            <div class="kv"><span>Repository</span><b>${esc((status && status.repo) || 'shawnradam/TheChambers')}</b></div>
            <div class="kv"><span>Current</span><b>${esc((state.health && state.health.commit) || current.short || '—')}${current.dirty ? ' · uncommitted changes' : ''}</b></div>
            <div class="kv"><span>Latest on GitHub</span><b>${esc(latest ? latest.short : '—')}</b></div>
            <div class="kv"><span>Status</span><b>${status && status.updateAvailable ? 'Update available' : status && status.error ? esc(status.error) : 'Up to date'}</b></div>
            ${latest && latest.url ? `<p class="meta"><a href="${esc(latest.url)}" target="_blank" rel="noreferrer noopener">See what changed on GitHub</a></p>` : ''}
            <label class="check"><input type="checkbox" data-auto-check ${updateSettings.autoCheckUpdates ? 'checked' : ''} /> Check for updates on start</label>
            <label class="check"><input type="checkbox" data-auto-update ${updateSettings.autoUpdate ? 'checked' : ''} /> Download new updates automatically</label>
            <div class="actions">
              <button class="btn" data-update-check type="button">Check now</button>
              <button class="btn primary" data-update-apply type="button" ${status && status.canApply ? '' : 'disabled'}>
                ${status && status.updateAvailable ? 'Download update' : 'Nothing to download'}
              </button>
            </div>`;

          const save = (changes) =>
            api('/api/settings', {method: 'POST', body: JSON.stringify(changes)})
              .then((next) => {
                updateSettings = {...updateSettings, ...next};
              })
              .catch((err) => toast(err.message));

          pane.querySelector('[data-auto-check]').addEventListener('change', (event) => {
            save({autoCheckUpdates: event.target.checked});
          });
          pane.querySelector('[data-auto-update]').addEventListener('change', (event) => {
            save({autoUpdate: event.target.checked});
          });
          pane.querySelector('[data-update-check]').addEventListener('click', async () => {
            toast('Checking GitHub…');
            const next = await checkUpdates({force: true});
            if (next) paint('updates');
          });
          pane.querySelector('[data-update-apply]').addEventListener('click', async () => {
            const result = await applyUpdate();
            if (result) paint('updates');
          });
        } else if (name === 'about') {
          pane.innerHTML = `
            <h3>TheChambers</h3>
            <p>Command Code from your phone, over Tailscale.</p>
            <p class="meta">Unofficial personal project. Not affiliated with or supported by Command
            Code, and it has nothing to do with their Telegram remote control — I don't use
            Telegram. </p>
            <div class="kv"><span>Version</span><b>${esc(state.health ? state.health.version : '—')}</b></div>
            <div class="kv"><span>Author</span><b>${esc((state.health && state.health.author) || 'Shawn Radam')}</b></div>
            <div class="kv"><span>Founder</span><b>${esc((state.health && state.health.founder) || 'Shawn Radam')}</b></div>
            <div class="kv"><span>Licence</span><b>GPL-3.0-or-later</b></div>
            <div class="kv"><span>Source</span><b>github.com/shawnradam/TheChambers</b></div>
            <div class="kv"><span>Workspace</span><b>${esc(state.workspace)}</b></div>
            <div class="kv"><span>CLI</span><b>${esc((state.health && state.health.cliEntry) || 'auto-detected')}</b></div>
            <h3>Session</h3>
            <div class="actions"><button class="btn" data-signout type="button">Sign out</button></div>`;
          pane.querySelector('[data-signout]').addEventListener('click', signOut);
        } else {
          pane.innerHTML = `
            <h3>General</h3>
            <p>App startup, security, connection, and privacy.</p>
            <h3>Workspace</h3>
            <div class="kv"><span>Default folder</span><b>${esc(state.workspace)}</b></div>
            <div class="kv"><span>Host</span><b>${esc(window.location.host)}</b></div>
            <div class="kv"><span>Server version</span><b>${esc(state.health ? state.health.version : '—')}</b></div>
            <h3>Security</h3>
            <div class="kv"><span>Password</span><b>%USERPROFILE%\\.config\\thechambers\\ui-password.txt</b></div>
            <div class="kv"><span>Trusted devices</span><b>30-day cookie</b></div>
            <div class="actions"><button class="btn" data-signout type="button">Sign out</button></div>`;
          pane.querySelector('[data-signout]').addEventListener('click', signOut);
        }
      };
      body.querySelectorAll('[data-pane]').forEach((button) => {
        button.addEventListener('click', () => paint(button.dataset.pane));
      });
      paint('general');
    },
  });
}

// Credits, not a redirect: the version line in the "..." menu opens this.
function openCredits() {
  const version = (state.health && state.health.version) || '1.2.0';
  const author = (state.health && state.health.author) || 'Shawn Radam';
  const licence = (state.health && state.health.license) || 'GPL-3.0-or-later';
  openModal({
    title: 'Credits',
    width: 520,
    content: `
      <div class="credits">
        <img class="credits-logo" src="/logo-192.png" alt="" />
        <h3>TheChambers</h3>
        <p class="credits-version">Version ${esc(version)}</p>
        <p>Created by <b>${esc(author)}</b>.</p>
        <p class="meta">Free software under the ${esc(licence)} licence. Use it, study it, change it and
        share it; distributed modified versions stay under the same licence.</p>
      </div>
      <div class="kv"><span>Source</span><b><a href="https://github.com/shawnradam/TheChambers" target="_blank" rel="noreferrer noopener">github.com/shawnradam/TheChambers</a></b></div>
      <div class="kv"><span>Agent</span><b>Command Code — commandcode.ai</b></div>
      <div class="kv"><span>Interface</span><b>player only — no agent code is bundled</b></div>
      <p class="meta">Unofficial personal project. Not affiliated with, endorsed by, or supported by
      Command Code, and unrelated to Command Code's own Telegram remote control.</p>`,
  });
}

// The know-how, inside the app rather than in a README nobody opens. Shown once on first visit
// and always available from the "..." menu and the "/help" command.
function openHelp() {
  localStorage.setItem('thechambers-help-seen', '1');
  openModal({
    title: 'How this works',
    width: 640,
    content: `
      <h3>Resuming a session</h3>
      <div class="kv"><span>In this app</span><b>Projects → open a folder → tap a session</b></div>
      <div class="kv"><span>In the terminal</span><b>/resume, then ↑ ↓ to pick, Enter to open</b></div>
      <div class="kv"><span>From a shell</span><b>cmd -c · cmd -r · cmd -r "name" · cmd --session 3f9a</b></div>
      <p class="meta">Sessions started headlessly (the ones this app creates) are hidden from the
      terminal picker, but an exact id still resumes them here or with
      <code>cmd --session &lt;id&gt;</code>.</p>

      <h3>The terminal and this page</h3>
      <p>Both read the same session file. A message sent here is appended to the transcript, but the
      terminal keeps its own copy in memory — run <code>/resume</code> there and pick the session to
      load it. Turns finished in the terminal appear here within a few seconds. The <b>live</b> pill
      means another writer (usually that terminal) is active; don't type in both at once.</p>

      <h3>While a turn is running</h3>
      <div class="kv"><span>Docket</span><b>files your text; it is heard when the turn ends</b></div>
      <div class="kv"><span>Gavel</span><b>stops the turn and sends your text instead, same session</b></div>
      <p class="meta">Enter mid-turn files to the docket; Ctrl+Enter is the gavel. Click Docket with an
      empty composer to review, drop or clear what is filed. The header spinner means the machine is
      working, even when the thread is scrolled away.</p>

      <h3>Modes</h3>
      <div class="kv"><span>Read-only</span><b>can read and explain; writes and commands are denied</b></div>
      <div class="kv"><span>Full access</span><b>edits files and runs commands without asking</b></div>
      <p class="meta">Plan and Accept edits appear when the active agent supports them. The mode
      applies to the next message, not the whole session.</p>

      <h3>Saving tokens</h3>
      <div class="kv"><span>Concise</span><b>the ≡ button: fewer words, less repeated work</b></div>
      <div class="kv"><span>Images</span><b>downscaled to 1024px before upload</b></div>
      <div class="kv"><span>Measure it</span><b>GET /api/usage?days=7 in this browser</b></div>
      <p class="meta">A fixed system prompt and tool schemas are outside the app's control, so expect
      10–20% typical savings, more on chat and screenshots, little on large refactors.</p>

      <h3>Agents</h3>
      <p>The composer's agent chip shows who is answering. Adapters live in
      <code>providers/</code> — one file per CLI agent — and extra ones load from
      <code>~/.config/thechambers/providers/</code>. <code>thechambers providers</code> lists them
      with availability.</p>

      <h3>If something looks wrong</h3>
      <div class="kv"><span>Address</span><b>this page must be opened over Tailscale, not the LAN</b></div>
      <div class="kv"><span>Password</span><b>~/.config/thechambers/ui-password.txt</b></div>
      <div class="kv"><span>Log</span><b>~/.config/thechambers/server.log</b></div>
      <div class="kv"><span>Health</span><b>thechambers status</b></div>`,
  });
}

function openShortcuts() {
  openModal({
    title: 'Keyboard shortcuts',
    width: 480,
    content: `
      <div class="shortcut"><span>Send message</span><kbd>Enter</kbd></div>
      <div class="shortcut"><span>File to the docket (mid-turn)</span><kbd>Enter</kbd></div>
      <div class="shortcut"><span>Gavel: stop and redirect (mid-turn)</span><kbd>Ctrl + Enter</kbd></div>
      <div class="shortcut"><span>New line</span><kbd>Shift + Enter</kbd></div>
      <div class="shortcut"><span>New session</span><kbd>Ctrl + Shift + N</kbd></div>
      <div class="shortcut"><span>Search chats and sessions</span><kbd>Ctrl + K</kbd></div>
      <div class="shortcut"><span>Toggle sidebar</span><kbd>Ctrl + B</kbd></div>
      <div class="shortcut"><span>Close panel or menu</span><kbd>Esc</kbd></div>`,
  });
}

function signOut() {
  fetch('/api/logout', {method: 'POST'}).finally(() => {
    location.href = '/login';
  });
}

function openMore() {
  els.more.classList.add('on');
  floatingMenu(
    els.more,
    (menu) => {
      menu.append(
        menuItem('Reload', {iconName: 'refresh', onClick: () => location.reload()}),
        menuItem('Search sessions', {
          iconName: 'search',
          onClick: () => {
            els.searchWrap.hidden = false;
            els.search.focus();
          },
        }),
        menuItem('How this works', {iconName: 'book', onClick: openHelp}),
        menuItem('Keyboard shortcuts', {iconName: 'sliders', onClick: openShortcuts}),
        menuItem('Settings', {iconName: 'gear', onClick: openSettings}),
        menuItem('Check for updates', {iconName: 'refresh', onClick: openUpdates}),
        menuSep(),
        menuItem(`Version ${state.health ? state.health.version : '—'}`, {
          iconName: 'book',
          onClick: openCredits,
        }),
        menuItem('Sign out', {iconName: 'lock', onClick: signOut}),
      );
    },
    {width: 220},
  );
}

// ---------------------------------------------------------------------------
// Navigation / responsive
// ---------------------------------------------------------------------------

function openNav() {
  els.app.classList.add('nav-open');
  els.scrim.hidden = false;
}

function closeNav() {
  els.app.classList.remove('nav-open');
  els.scrim.hidden = true;
}

// ---------------------------------------------------------------------------
// Composer picker: / commands, @ files, $ skills
// ---------------------------------------------------------------------------

const APP_COMMANDS = [
  {name: '/new', desc: 'Start a new session', source: 'APP', run: () => newChat()},
  {name: '/clear', desc: 'Start a new session with empty context', source: 'APP', run: () => newChat()},
  {name: '/model', desc: 'Choose the model for this session', source: 'APP', run: () => modelMenu()},
  {name: '/mode', desc: 'Read-only, accept edits, or full access', source: 'APP', run: () => permissionMenu()},
  {name: '/plan', desc: 'Switch the agent to plan mode', source: 'APP', run: () => setAgent('plan')},
  {name: '/build', desc: 'Switch the agent back to build', source: 'APP', run: () => setAgent('build')},
  {name: '/rename', desc: 'Rename the current session', source: 'APP', run: () => renameActiveConversation()},
  {name: '/export', desc: 'Download the current conversation as JSON', source: 'APP', run: () => exportActiveConversation()},
  {name: '/context', desc: 'Open the context panel', source: 'APP', run: () => openPanel('context')},
  {name: '/usage', desc: 'Open context and usage', source: 'APP', run: () => openPanel('context')},
  {name: '/stop', desc: 'Stop the running turn', source: 'APP', run: () => stopTurn()},
  {
    name: '/docket',
    desc: 'File this for after the turn, or review what is filed',
    source: 'APP',
    run: () => {
      if (!fileDocket()) openDocket();
    },
  },
  {
    name: '/gavel',
    desc: 'Stop the turn and send this instead',
    source: 'APP',
    run: () => {
      if (!state.busy) {
        toast('Nothing is running.');
        return;
      }
      if (!els.input.value.trim()) {
        toast('Type what to send, then run this again.');
        return;
      }
      gavelMessage();
    },
  },
  {name: '/goal', desc: 'Start a goal with the next message', source: 'APP', run: () => goalToggle()},
  {name: '/settings', desc: 'Open settings', source: 'APP', run: () => openSettings()},
  {name: '/concise', desc: 'Toggle concise mode for this conversation', source: 'APP', run: () => conciseToggle()},
  {name: '/help', desc: 'How this works: resuming, the bridge, modes, tokens', source: 'APP', run: () => openHelp()},
  {name: '/keys', desc: 'Keyboard shortcuts', source: 'APP', run: () => openShortcuts()},
];

const STARTER_COMMANDS = [
  {
    name: '/explore',
    desc: 'Get oriented in this codebase',
    source: 'STARTER',
    prompt: 'Explore the codebase and tell me how it is structured.',
  },
  {
    name: '/catch-up',
    desc: 'Re-establish context and pick up where you left off',
    source: 'STARTER',
    prompt: 'Catch me up on what changed recently in this project.',
  },
  {
    name: '/debug',
    desc: 'Guided root-cause investigation for a bug',
    source: 'STARTER',
    prompt: 'Debug the current issue in this project.',
  },
  {
    name: '/plan-feature',
    desc: 'Start a guided feature planning session',
    source: 'STARTER',
    prompt: 'Help me plan a feature for this project.',
  },
  {
    name: '/craft-goal',
    desc: 'Turn an idea into a clear, verifiable goal',
    source: 'STARTER',
    prompt: 'Set a goal for this session and work towards it.',
  },
  {
    name: '/review',
    desc: 'Review uncommitted changes',
    source: 'STARTER',
    prompt: 'Review my uncommitted changes.',
  },
];

const CMDC_COMMANDS = [
  {name: '/init', desc: 'Guided AGENTS.md setup for this project', source: 'CMDC'},
  {name: '/memory', desc: 'Manage Command Code memory', source: 'CMDC'},
  {name: '/resume', desc: 'Resume a past conversation', source: 'CMDC'},
  {name: '/fork', desc: 'Fork this conversation into a new session', source: 'CMDC'},
  {name: '/rewind', desc: 'Restore to a previous checkpoint', source: 'CMDC'},
  {name: '/tree', desc: 'Browse the session tree', source: 'CMDC'},
  {name: '/compact', desc: 'Compact the conversation history', source: 'CMDC'},
  {name: '/config', desc: 'Search and change settings', source: 'CMDC'},
  {name: '/status', desc: 'Show environment status', source: 'CMDC'},
  {name: '/todos', desc: 'Manage the session todo list', source: 'CMDC'},
  {name: '/loop', desc: 'Re-run a task on an interval', source: 'CMDC'},
  {name: '/btw', desc: 'Ask a quick side question mid-turn', source: 'CMDC'},
  {name: '/add-dir', desc: 'Manage additional directory scope', source: 'CMDC'},
  {name: '/mcp', desc: 'Manage MCP server connections', source: 'CMDC'},
  {name: '/agents', desc: 'Manage agent configurations', source: 'CMDC'},
  {name: '/design', desc: 'Design partner: audit, build, compose', source: 'CMDC'},
  {name: '/connect', desc: 'Connect AI providers', source: 'CMDC'},
  {name: '/update', desc: 'Update Command Code', source: 'CMDC'},
  {name: '/reload', desc: 'Restart and resume this session', source: 'CMDC'},
  {name: '/worktree', desc: 'Create, list, or switch git worktrees', source: 'CMDC'},
  {name: '/skills', desc: 'Browse agent skills', source: 'CMDC'},
  {name: '/session-file', desc: 'Show the session id and transcript path', source: 'CMDC'},
  {name: '/changelog', desc: 'See what is new', source: 'CMDC'},
  {name: '/hotkeys', desc: 'Show all keyboard shortcuts', source: 'CMDC'},
];

const COMMAND_CATALOG = (() => {
  const seen = new Map();
  for (const item of [...APP_COMMANDS, ...STARTER_COMMANDS, ...CMDC_COMMANDS]) {
    if (!seen.has(item.name)) seen.set(item.name, {...item, kind: 'command'});
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

function setAgent(agent) {
  state.agent = agent;
  localStorage.setItem('thechambers-agent', agent);
  refreshComposerState();
}

function renameActiveConversation() {
  if (!state.conversation) {
    toast('Open a session first.');
    return;
  }
  const conv = state.conversation;
  openPrompt({
    title: 'Rename session',
    label: 'Name',
    value: conv.title || '',
    confirm: 'Rename',
    onConfirm: async (title) => {
      try {
        await api(`/api/conversations/${conv.id}`, {method: 'PATCH', body: JSON.stringify({title})});
        conv.title = title;
        if (state.activeId === conv.id) els.title.textContent = title;
        await loadState();
      } catch (err) {
        toast(err.message);
      }
    },
  });
}

function exportActiveConversation() {
  if (!state.conversation) {
    toast('Open a session first.');
    return;
  }
  exportConversation(state.conversation);
}

function relativeToWorkspace(fullPath) {
  return String(fullPath || '')
    .replace(state.workspace, '')
    .replace(/^[\\/]/, '')
    .replace(/\\/g, '/');
}

function composerToken() {
  const value = els.input.value;
  const caret = els.input.selectionStart == null ? value.length : els.input.selectionStart;
  const before = value.slice(0, caret);
  let match = before.match(/(^|[\s])\/([A-Za-z0-9:_-]*)$/);
  if (match) return {mode: 'command', query: match[2], start: caret - match[2].length - 1};
  match = before.match(/(^|[\s])@([^\s]*)$/);
  if (match) return {mode: 'mention', query: match[2], start: caret - match[2].length - 1};
  match = before.match(/(^|[\s])\$([^\s]*)$/);
  if (match) return {mode: 'skill', query: match[2], start: caret - match[2].length - 1};
  return null;
}

function ensureSkills() {
  if (state.skills || state.skillsLoading) return;
  state.skillsLoading = true;
  api('/api/skills')
    .then((data) => {
      state.skills = data.skills || [];
    })
    .catch(() => {
      state.skills = [];
    })
    .finally(() => {
      state.skillsLoading = false;
      if (state.picker.open && state.picker.mode === 'skill') {
        state.picker.items = pickerItems('skill', state.picker.query);
        paintPicker();
      }
    });
}

function scheduleMentions(query) {
  clearTimeout(state.picker.timer);
  state.picker.timer = setTimeout(async () => {
    state.picker.timer = null;
    const key = query.toLowerCase();
    try {
      let entries = [];
      if (!key) {
        const data = await api(`/api/files?workspace=${encodeURIComponent(state.workspace)}`);
        entries = (data.entries || []).slice(0, 40);
      } else {
        const data = await api(
          `/api/search?workspace=${encodeURIComponent(state.workspace)}&q=${encodeURIComponent(key)}`,
        );
        entries = (data.entries || []).slice(0, 40);
      }
      state.mentionCache.set(
        key,
        entries.map((entry) => {
          const rel = relativeToWorkspace(entry.path) + (entry.dir ? '/' : '');
          const size = entry.dir ? 'folder' : `${Math.max(1, Math.round((entry.size || 0) / 1024))} KB`;
          return {kind: 'mention', name: rel, desc: size, insert: rel};
        }),
      );
    } catch {
      state.mentionCache.set(key, []);
    }
    if (state.picker.open && state.picker.mode === 'mention' && state.picker.query.toLowerCase() === key) {
      state.picker.items = state.mentionCache.get(key) || [];
      state.picker.index = Math.min(state.picker.index, Math.max(0, state.picker.items.length - 1));
      paintPicker();
    }
  }, 160);
}

function pickerItems(mode, query) {
  const needle = query.toLowerCase();
  if (mode === 'command') {
    const pluginCommands = (state.plugins || [])
      .filter((plugin) => plugin.enabled && plugin.loaded)
      .flatMap((plugin) =>
        (plugin.commands || []).map((command) => ({
          kind: 'command',
          name: `/${command.name}`,
          desc: command.description || `${plugin.name} plugin`,
          source: 'PLUGIN',
          run: command.action === 'insert' ? undefined : () => openPanel(`plugin:${plugin.id}`),
          prompt: command.action === 'insert' ? command.text || command.name : undefined,
        })),
      );
    const seen = new Set();
    return [...COMMAND_CATALOG, ...pluginCommands]
      .filter((item) => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      })
      .filter(
        (item) =>
          item.name.slice(1).toLowerCase().includes(needle) ||
          item.desc.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'skill') {
    ensureSkills();
    return (state.skills || [])
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(needle) ||
          (skill.description || '').toLowerCase().includes(needle),
      )
      .map((skill) => ({
        kind: 'skill',
        name: `$${skill.name}`,
        desc: (skill.description || 'Skill').replace(/[*`]/g, ''),
        insert: skill.name,
        source: 'SKILL',
      }));
  }
  const key = query.toLowerCase();
  if (state.mentionCache.has(key)) return state.mentionCache.get(key);
  scheduleMentions(query);
  return [];
}

function ensurePickerElement() {
  let menu = document.querySelector('.composer-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'composer-menu';
    menu.hidden = true;
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => {
      const row = event.target.closest('[data-picker-index]');
      if (!row) return;
      state.picker.index = Number(row.dataset.pickerIndex);
      acceptPicker();
    });
    menu.addEventListener('mousemove', (event) => {
      const row = event.target.closest('[data-picker-index]');
      if (row) setPickerIndex(Number(row.dataset.pickerIndex));
    });
    els.composer.append(menu);
  }
  return menu;
}

function paintPicker() {
  const menu = ensurePickerElement();
  if (!state.picker.open) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  const anchor = els.composer.querySelector('.composer-card') || els.input;
  const space = anchor.getBoundingClientRect().top - 64;
  const cap = window.innerWidth <= 900 ? Math.min(388, space) : 260;
  menu.style.maxHeight = `${Math.max(140, cap)}px`;
  const {items, index, mode, query} = state.picker;
  let body;
  if (!items.length) {
    const label =
      mode === 'mention'
        ? query
          ? 'No matching files.'
          : 'Loading files…'
        : mode === 'skill'
          ? state.skills
            ? 'No matching skills.'
            : 'Loading skills…'
          : 'No matching commands.';
    body = `<div class="composer-menu-empty">${esc(label)}</div>`;
  } else {
    body = items
      .map(
        (item, i) =>
          `<div class="composer-command${i === index ? ' selected' : ''}" data-picker-index="${i}" role="option" aria-selected="${i === index}">${
            item.kind === 'command' ? '' : icon(item.kind === 'skill' ? 'spark' : 'file')
          }<span class="name">${esc(item.name)}</span><span class="desc">${esc(item.desc || '')}</span>${
            item.source ? `<span class="source">${esc(item.source)}</span>` : ''
          }</div>`,
      )
      .join('');
  }
  menu.innerHTML = `<div class="composer-menu-list">${body}</div><div class="composer-menu-foot">↑↓ navigate · Enter select · Esc close</div>`;
  const list = menu.querySelector('.composer-menu-list');
  if (list) list.scrollTop = 0;
  const selected = menu.querySelector('.composer-command.selected');
  if (selected) selected.scrollIntoView({block: 'nearest'});
}

function setPickerIndex(next) {
  const count = state.picker.items.length;
  if (!count) return;
  state.picker.index = (next + count) % count;
  const menu = ensurePickerElement();
  menu.querySelectorAll('.composer-command').forEach((row, i) => {
    row.classList.toggle('selected', i === state.picker.index);
    row.setAttribute('aria-selected', String(i === state.picker.index));
  });
  const selected = menu.querySelector('.composer-command.selected');
  if (selected) selected.scrollIntoView({block: 'nearest'});
}

function closePicker() {
  if (state.picker.timer) {
    clearTimeout(state.picker.timer);
    state.picker.timer = null;
  }
  state.picker.open = false;
  const menu = document.querySelector('.composer-menu');
  if (menu) menu.hidden = true;
}

function acceptPicker() {
  const item = state.picker.items[state.picker.index];
  if (!item) return;
  const value = els.input.value;
  const caret = els.input.selectionStart == null ? value.length : els.input.selectionStart;
  const start = state.picker.tokenStart;
  closePicker();

  if (item.kind === 'command' && item.run) {
    els.input.value = value.slice(0, start) + value.slice(caret);
    const pos = Math.min(start, els.input.value.length);
    els.input.setSelectionRange(pos, pos);
    autoGrow();
    updateSendState();
    item.run();
    return;
  }

  let insert = item.name + ' ';
  if (item.kind === 'command' && item.prompt) insert = item.prompt;
  if (item.kind === 'mention') insert = `@${item.insert} `;
  if (item.kind === 'skill') insert = `$${item.insert} `;

  els.input.value = value.slice(0, start) + insert + value.slice(caret);
  const pos = start + insert.length;
  els.input.focus();
  els.input.setSelectionRange(pos, pos);
  autoGrow();
  updateSendState();
}

function updatePicker() {
  const token = composerToken();
  if (!token) {
    closePicker();
    return;
  }
  const previous = state.picker.items[state.picker.index];
  const sameQuery =
    state.picker.open && state.picker.mode === token.mode && state.picker.query === token.query;
  const items = pickerItems(token.mode, token.query);
  const kept = previous ? items.findIndex((item) => item.name === previous.name) : -1;
  state.picker.open = true;
  state.picker.mode = token.mode;
  state.picker.query = token.query;
  state.picker.tokenStart = token.start;
  state.picker.items = items;
  state.picker.index = sameQuery && kept >= 0 ? kept : 0;
  if (state.picker.index >= items.length) state.picker.index = Math.max(0, items.length - 1);
  paintPicker();
}

function handlePickerKeys(event) {
  if (!state.picker.open) return false;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setPickerIndex(state.picker.index + 1);
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setPickerIndex(state.picker.index - 1);
    return true;
  }
  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
    event.preventDefault();
    acceptPicker();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closePicker();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

els.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  closePicker();
  const typed = els.input.value.trim();
  const files = state.attachments.slice();
  if (!typed && !files.length) return;
  // Pressing Enter mid-turn queues the message rather than doing nothing.
  if (state.busy) {
    fileDocket();
    return;
  }

  let text = typed || 'Take a look at the attached file.';
  if (state.goal && !/^goal:/i.test(text)) text = `Goal: ${text}`;
  if (files.length) {
    text += `\n\nAttached files (open them from disk if you need to look):\n${files
      .map((file) => `- ${file.path}`)
      .join('\n')}`;
  }

  state.attachments = [];
  renderAttachments();
  els.input.value = '';
  autoGrow();
  updateSendState();
  sendTurn(text);
});

els.input.addEventListener('input', () => {
  autoGrow();
  updateSendState();
  updatePicker();
});

els.input.addEventListener('click', () => updatePicker());
els.input.addEventListener('keyup', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updatePicker();
});

els.input.addEventListener('keydown', (event) => {
  if (handlePickerKeys(event)) return;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // Ctrl+Enter is the gavel: interrupting a running turn should take a deliberate chord.
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && state.busy) {
    event.preventDefault();
    gavelMessage();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !coarse) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
  if (event.key === 'Escape') closeMenus();
});

els.stop.addEventListener('click', stopTurn);
els.docket.addEventListener('click', () => {
  if (els.input.value.trim()) fileDocket();
  else openDocket();
});
els.gavel.addEventListener('click', gavelMessage);

els.suggestions.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip || chip.id === 'add-starter' || state.busy) return;
  els.input.value = chip.dataset.prompt || chip.textContent.trim();
  autoGrow();
  updateSendState();
  els.input.focus();
});

els.addStarter.addEventListener('click', () => {
  openPrompt({
    title: 'Add a starter',
    label: 'Prompt',
    placeholder: 'What should the starter ask?',
    confirm: 'Add',
    onConfirm: (text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.prompt = text;
      chip.innerHTML = `${icon('spark')}${esc(text)}`;
      els.addStarter.before(chip);
    },
  });
});

els.permissions.addEventListener('click', permissionMenu);
els.agentBtn.addEventListener('click', agentMenu);
els.modelBtn.addEventListener('click', modelMenu);
els.goal.addEventListener('click', goalToggle);
els.concise.addEventListener('click', conciseToggle);
els.attach.addEventListener('click', attachFiles);

els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files && els.fileInput.files.length) uploadFiles(els.fileInput.files);
  els.fileInput.value = '';
});

// Paste a screenshot straight into the composer (Ctrl/Cmd+V, or long-press → Paste).
els.input.addEventListener('paste', (event) => {
  const files = [...((event.clipboardData && event.clipboardData.files) || [])];
  if (!files.length) return;
  event.preventDefault();
  uploadFiles(files);
});

// Drag and drop, for the desktop browser.
['dragover', 'drop'].forEach((type) => {
  els.composer.addEventListener(type, (event) => {
    if (type === 'dragover') {
      event.preventDefault();
      els.composer.classList.add('dropping');
      return;
    }
    event.preventDefault();
    els.composer.classList.remove('dropping');
    const files = [...((event.dataTransfer && event.dataTransfer.files) || [])];
    if (files.length) uploadFiles(files);
  });
});

els.composer.addEventListener('dragleave', () => els.composer.classList.remove('dropping'));

els.ctxRing.addEventListener('click', () => openPanel('context'));
els.toggleSession.addEventListener('click', toggleSessionPanel);
els.railConfig.addEventListener('click', openSettings);

els.rail.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-panel]');
  if (button) openPanel(button.dataset.panel);
});

els.chooseProject.addEventListener('click', (event) => {
  event.stopPropagation();
  const showing = !els.projectMenu.hidden;
  closeMenus();
  if (showing) return;
  renderProjectMenu();
  els.projectMenu.hidden = false;
  const input = els.projectMenu.querySelector('#project-search');
  if (input) input.focus();
});

document.addEventListener('click', (event) => {
  if (!els.projectMenu.hidden && !els.projectMenu.contains(event.target) && event.target !== els.chooseProject) {
    els.projectMenu.hidden = true;
  }
});

document.addEventListener('mousedown', (event) => {
  if (!state.picker.open) return;
  if (event.target === els.input || event.target.closest('.composer-menu')) return;
  closePicker();
});

els.newChat.addEventListener('click', newChat);
els.newChatGroup.addEventListener('click', newChat);

els.addProject.addEventListener('click', promptForProject);
els.addProjectGroup.addEventListener('click', promptForProject);
els.shortcuts.addEventListener('click', openShortcuts);
els.settings.addEventListener('click', openSettings);
els.updates.addEventListener('click', openUpdates);
els.more.addEventListener('click', openMore);

els.exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({conversations: state.conversations, projects: state.projects}, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'thechambers-chats.json';
  link.click();
  URL.revokeObjectURL(url);
});

els.convMenu.addEventListener('click', () => {
  if (!state.conversation) return;
  sessionMenu(els.convMenu, state.conversation);
});

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

els.menu.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches) {
    openNav();
    return;
  }
  els.app.classList.toggle('side-collapsed');
});

els.sidebarClose.addEventListener('click', closeNav);

els.sidebarToggle.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches) {
    closeNav();
    return;
  }
  els.app.classList.toggle('side-collapsed');
});

els.scrim.addEventListener('click', closeNav);

els.scroll.addEventListener('scroll', () => {
  live.pinned = nearBottom();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePicker();
    closeMenus();
    closeNav();
    if (!els.panel.hidden) closePanel();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    els.searchWrap.hidden = false;
    els.search.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    els.app.classList.toggle('side-collapsed');
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderComposerControls() {
  refreshComposerState();
  updateSendState();
}

async function boot() {
  placeComposer(true);
  renderComposerControls();
  renderProjectMenu();
  applyConciseState();
  if (!localStorage.getItem('thechambers-help-seen')) {
    setTimeout(() => openHelp(), 900);
  }

  try {
    await loadHealth();
    await loadProjects();
    await loadState();
    await loadNotes();
    await loadPlugins();
  } catch (err) {
    toast(err.message);
    return;
  }
  await loadSessions(state.workspace);
  showEmpty();
  renderSidebar();
  updateContextRing();

  // Reopen the conversation this device had open before the reload, if it still exists.
  const openId = localStorage.getItem('thechambers-open');
  if (openId && state.conversations.some((conv) => conv.id === openId)) {
    await openConversation(openId);
  }

  // Updates: read the preference, then keep an eye on GitHub. The badge appears on its own —
  // no reload needed — every five minutes, and whenever the tab comes back into view.
  await loadSettings();
  if (updateSettings.autoCheckUpdates) {
    checkUpdates({silent: true});
    setInterval(() => {
      if (!document.hidden) checkUpdates({silent: true});
    }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastUpdateCheck > 60000) checkUpdates({silent: true});
    });
  }

  if (window.innerWidth > 1180) {
    renderSessionCard();
    els.sessionPanel.hidden = false;
  }

  // Keep the model list warm so the menu opens instantly.
  api('/api/models')
    .then((data) => {
      state.models = data;
      updateContextRing();
      renderSessionCard();
    })
    .catch(() => {});

  // Sessions written by a terminal change the live dots and counts; refresh the sidebar
  // without disturbing the open conversation.
  setInterval(() => {
    if (document.hidden) return;
    loadState().catch(() => {});
    if (state.expanded.has(state.workspace)) loadSessions(state.workspace).catch(() => {});
  }, 10000);

  els.input.focus();
}

boot();
