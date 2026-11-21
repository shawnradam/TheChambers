const byId = (id) => document.getElementById('workroom-' + id);
const roles = {programmer: 'Programmer', designer: 'Designer', planner: 'Planner', debugger: 'Debugger'};
const phases = {
  planning: 'Planning and design', 'brief-reviewed': 'Brief awaiting Admin approval',
  implementation: 'Implementation', verification: 'Commit awaiting Debugger review',
  'needs-fix': 'Changes requested', verified: 'Verified commit awaiting Admin approval',
  'approved-push': 'Approved for GitHub push', pushed: 'Pushed to GitHub',
};
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const options = (items, selected) => Object.entries(items).map(([value, label]) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
const button = (label) => `<button type="submit">${label}</button>`;
const text = (name, label, extra = '') => `<label>${label}<input name="${name}" required ${extra}></label>`;
const select = (name, label, choices) => `<label>${label}<select name="${name}" required>${choices}</select></label>`;
const note = (label) => `<label>${label}<textarea name="note" required maxlength="12000" rows="3"></textarea></label>`;
const action = (name, fields, label) =>
  `<form data-route="action" data-action="${name}">${fields}${button(label)}</form>`;
const workerFields = (worker = {}) => text('name', 'Name', `maxlength="80" value="${escape(worker.name)}"`) +
  text('email', 'Email', `type="email" maxlength="200" value="${escape(worker.email)}"`) +
  select('role', 'Role', options(roles, worker.role));
let state;
let taskId = '';

async function api(route, body) {
  const response = await fetch('/api/workrooms/' + route, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), {status: response.status});
  return result;
}

function setStatus(message, failed = false) {
  byId('status').textContent = message;
  byId('status').classList.toggle('workroom-error', failed);
}

function workersFor(role, selected) {
  const workers = state.workers.filter((worker) => worker.role === role);
  return '<option value="">Choose worker</option>' +
    options(Object.fromEntries(workers.map(({id, name, email}) => [id, `${name} · ${email}`])), selected);
}

function renderAdmin() {
  const workers = state.workers.map((worker) => `
    <details>
      <summary>${escape(worker.name)} · ${roles[worker.role]} <small>${escape(worker.email)}</small></summary>
      <form data-route="workers" data-action="update" data-id="${escape(worker.id)}">
        ${workerFields(worker)}${button('Save worker')}
      </form>
      <div class="workroom-actions">
        <button type="button" data-worker-action="reset" data-id="${escape(worker.id)}">Reset password</button>
        <button type="button" data-worker-action="remove" data-id="${escape(worker.id)}">Remove access</button>
      </div>
    </details>`).join('');
  return `<section><h2>Workers</h2>
    <form data-route="workers" data-action="create">${workerFields()}${button('Add worker and generate password')}</form>
    ${workers ? `<div class="workroom-list">${workers}</div>` : '<p>No workers yet.</p>'}
    </section>
    <section><h2>Create task</h2>
      <form data-route="tasks">
        ${text('title', 'Title', 'maxlength="120"')}
        <label>Shared brief<textarea name="brief" required maxlength="12000" rows="3"></textarea></label>
        ${text('workspace', 'Git workspace path', 'maxlength="2048"')}
        ${text('branch', 'GitHub destination branch', 'maxlength="180"')}
        ${Object.entries(roles).map(([role, name]) => select(role, name, workersFor(role))).join('')}
        ${button('Create task')}
      </form>
    </section>`;
}

function record(title, item) {
  if (!item) return '';
  const date = new Date(item.at).toLocaleString();
  const outcome = item.pass === undefined ? '' : item.pass ? ' · Passed' : ' · Changes requested';
  return `<article><h3>${title}${outcome}</h3><small>${escape(item.by)} · ${escape(date)}</small>
    ${item.sha ? `<code>${escape(item.sha)}</code>` : ''}
    ${item.note ? `<p class="workroom-message">${escape(item.note)}</p>` : ''}</article>`;
}

function workflow(task, role) {
  const {phase} = task;
  const pass = select('pass', 'Result', options({true: 'Pass', false: 'Request changes'}));
  const sha = task.implementation ? `<input type="hidden" name="sha" value="${escape(task.implementation.sha)}">` : '';
  if (role === 'planner' && ['planning', 'brief-reviewed'].includes(phase)) return action('plan', note('Plan'), 'Submit plan');
  if (role === 'designer' && ['planning', 'brief-reviewed'].includes(phase)) return action('design', note('Design'), 'Submit design');
  if (role === 'debugger' && phase === 'planning' && task.plan && task.design) {
    return action('review-brief', pass + note('Review evidence'), 'Review brief');
  }
  if (role === 'admin' && phase === 'brief-reviewed') return action('approve-brief', '', 'Approve brief');
  if (role === 'debugger' && phase === 'verification') return action('verify', sha + pass + note('Test results'), 'Verify commit');
  if (role === 'admin' && phase === 'verified') return action('approve-push', sha, 'Approve verified commit');
  if (role === 'programmer' && !['planning', 'brief-reviewed', 'pushed'].includes(phase)) {
    return (phase === 'approved-push' ? action('push', sha, 'Push approved commit to GitHub') : '') +
      action('submit-commit', text('sha', 'Full commit hash', 'maxlength="64"') + note('Implementation notes'), 'Submit commit for review');
  }
  return '';
}

function renderTask(task, role) {
  if (!task) return '<p>No tasks assigned.</p>';
  const admin = role === 'admin';
  const records = record('Plan', task.plan) + record('Design', task.design) +
    record('Brief review', task.briefReview) + record('Implementation', task.implementation) +
    record('Verification', task.verification) + record('Push approval', task.approval) + record('GitHub push', task.push);
  const logs = Object.entries(task.notes).map(([room, entries]) => `
    <article><h3>${roles[room]} room</h3>
    ${entries.length ? entries.map((item) => `<small>${escape(item.by)} · ${escape(new Date(item.at).toLocaleString())}</small>
      <p class="workroom-message">${escape(item.note)}</p>`).join('') : '<p>No messages yet.</p>'}</article>`).join('');
  const open = task.phase !== 'pushed';
  const assignments = admin && open ? `<details><summary>Reassign workers</summary>
    ${Object.entries(roles).map(([room, name]) => action('assign',
      `<input type="hidden" name="role" value="${room}">` + select('workerId', name, workersFor(room, task.assignees[room])),
      'Save assignment')).join('')}</details>` : '';
  return `<div class="workroom-brief"><h3>${escape(task.title)}</h3><small>${phases[task.phase]}</small>
    <p class="workroom-message">${escape(task.brief)}</p>
    ${task.workspace ? `<small>Workspace</small><code>${escape(task.workspace)}</code>` : ''}
    <small>Destination branch</small><code>${escape(task.branch)}</code></div>
    ${records}<div class="workroom-actions">${workflow(task, role)}</div>${assignments}
    <div class="workroom-list">${logs}</div>
    ${open ? action('note', (admin ? select('room', 'Room', options(roles)) : '') + note('Room message'), 'Send message') : ''}`;
}

function render() {
  const {user, tasks, task, budget} = state;
  const admin = user.role === 'admin';
  byId('login').hidden = true;
  byId('refresh').hidden = false;
  byId('account').innerHTML = admin
    ? '<strong>ID 1 · Admin</strong><a href="/">Back to TheChambers</a>'
    : `<strong>${escape(user.name)} · ${roles[user.role]}</strong><button type="button" id="workroom-logout">Sign out</button>`;
  const entries = Object.entries(budget).map(([room, {used, cap, percent}]) =>
    `<li><strong>${roles[room]}</strong><span>${used} / ${cap} units · ${percent}%</span></li>`).join('');
  byId('board').innerHTML = `
    <section><h2>Usage allowance</h2><ul>${entries}</ul>
      ${admin ? `<form data-route="budget">${text('total', 'Total units', `type="number" min="10" max="1000000000" step="1" value="${state.budgetTotal || ''}"`)}${button('Save allowance')}</form>` : ''}
      ${task && task.phase !== 'pushed' ? action('usage', (admin ? select('role', 'Role', options(roles)) : '') +
        text('units', 'Units to report', 'type="number" min="1" step="1"'), 'Report usage') : ''}
    </section>
    ${admin ? renderAdmin() : ''}
    <section><h2>Task rooms</h2>
      ${tasks.length ? `<label>Task<select id="workroom-task">${options(Object.fromEntries(tasks.map(({id, title}) => [id, title])), task?.id)}</select></label>` : ''}
      ${renderTask(task, user.role)}
    </section>`;
}

async function load() {
  try {
    state = await api('view' + (taskId ? '?task=' + encodeURIComponent(taskId) : ''));
    taskId = state.task?.id || '';
    render();
  } catch (error) {
    if (error.status === 404 && taskId) {
      taskId = '';
      return load();
    }
    if (error.status !== 401) throw error;
    state = null;
    byId('board').replaceChildren();
    byId('password').replaceChildren();
    byId('account').innerHTML = '<a href="/">Admin sign-in</a>';
    byId('login').hidden = false;
    byId('refresh').hidden = true;
  }
}

function showPassword({worker, password}) {
  byId('password').innerHTML = `<section><h2>Generated password</h2>
    <p>Share this password privately with ${escape(worker.name)} (${escape(worker.email)}). It is shown once.</p>
    <label>Password<input id="workroom-generated" readonly value="${escape(password)}" autocomplete="off"></label>
    <div class="workroom-actions"><button id="workroom-copy" type="button">Copy password</button>
      <button id="workroom-dismiss" type="button">Dismiss</button></div></section>`;
  byId('generated').focus();
}

let pending = false;
async function run(callback, control) {
  if (pending) return;
  pending = true;
  if (control) control.disabled = true;
  setStatus('');
  try {
    await callback();
  } catch (error) {
    setStatus(error.message, true);
    if (error.status === 401 && state) await load().catch(() => {});
  } finally {
    if (control) control.disabled = false;
    pending = false;
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  const {route, action: name, id} = form.dataset;
  if (!route) return;
  event.preventDefault();
  if (name === 'push' && !confirm('Push this approved commit to GitHub?')) return;
  const body = Object.fromEntries(new FormData(form));
  if (name) body.action = name;
  if (id) body.id = id;
  if (route === 'action') body.taskId = taskId;
  if ('pass' in body) body.pass = body.pass === 'true';
  if ('units' in body) body.units = Number(body.units);
  if ('total' in body) body.total = Number(body.total);
  if (route === 'tasks') {
    body.assignees = Object.fromEntries(Object.keys(roles).map((role) => [role, body[role]]));
  }
  run(async () => {
    const result = await api(route, body);
    if (result.task) taskId = result.task.id;
    if (route === 'login') form.reset();
    await load();
    if (result.password) showPassword(result);
    setStatus(name === 'push' ? 'Approved commit pushed to GitHub.' : route === 'login' ? '' : 'Saved.');
  }, event.submitter);
});

document.addEventListener('click', (event) => {
  const control = event.target.closest('button');
  if (!control) return;
  const {workerAction, id} = control.dataset;
  if (workerAction) {
    if (!confirm(workerAction === 'remove' ? 'Remove this worker’s access?' : 'Reset this worker’s password and revoke their current sign-in?')) return;
    run(async () => {
      const result = await api('workers', {action: workerAction, id});
      await load();
      if (result.password) showPassword(result);
      setStatus(workerAction === 'remove' ? 'Worker access removed.' : 'Password reset.');
    }, control);
  } else if (control === byId('refresh')) {
    run(async () => {
      await load();
      setStatus('Workrooms refreshed.');
    }, control);
  } else if (control === byId('logout')) {
    run(async () => {
      await api('logout', {});
      taskId = '';
      await load();
    }, control);
  } else if (control === byId('copy')) {
    run(async () => {
      await navigator.clipboard.writeText(byId('generated').value);
      setStatus('Password copied.');
    }, control);
  } else if (control === byId('dismiss')) {
    byId('password').replaceChildren();
  }
});

document.addEventListener('change', (event) => {
  if (event.target !== byId('task')) return;
  taskId = event.target.value;
  run(load, event.target);
});

run(load);
if (typeof finishStartup === 'function') finishStartup();
