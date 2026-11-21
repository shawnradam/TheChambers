import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SHARES = {programmer: 45, designer: 25, planner: 20, debugger: 10};
const ROLES = Object.keys(SHARES);
const COOKIE = 'thechambers_worker';
const digest = (password) => crypto.createHash('sha256').update(password).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const stamp = (user, note, extra) => ({
  by: user.name, at: new Date().toISOString(), note, ...extra,
});

class WorkroomError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, message, status) {
  if (!condition) throw new WorkroomError(message, status);
}

function requiredText(value, label, max = 12000) {
  const text = typeof value === 'string' ? value.trim() : '';
  requireThat(text && text.length <= max, `Enter ${label} (up to ${max} characters).`);
  return text;
}

function allow(user, role) {
  requireThat(user.role === role, `This action requires ${role} access.`, 403);
}

const publicWorker = ({id, name, email, role}) => ({id, name, email, role});
const publicTask = ({id, title, phase}) => ({id, title, phase});

function visibleTask(task, user) {
  if (user.role === 'admin') return task;
  const {role} = user;
  requireThat(task.assignees[role] === user.id, 'This workroom is not assigned to you.', 404);
  const reviewed = !['planning', 'brief-reviewed'].includes(task.phase);
  return {
    ...publicTask(task), brief: task.brief, branch: task.branch,
    notes: {[role]: task.notes[role].filter((note) => note.recipient === user.id)},
    plan: role === 'planner' || role === 'debugger' || (role === 'programmer' && reviewed) ? task.plan : null,
    design: role === 'designer' || role === 'debugger' || (role === 'programmer' && reviewed) ? task.design : null,
    briefReview: task.briefReview,
    implementation: ['programmer', 'debugger'].includes(role) ? task.implementation : null,
    verification: task.verification,
    push: task.push,
    workspace: ['programmer', 'debugger'].includes(role) ? task.workspace : null,
    remote: role === 'programmer' ? task.remote : null,
  };
}

export function createWorkrooms({file, secret, readJson, json, runProcess, loginAllowed, noteLoginFailure}) {
  let queue = Promise.resolve();
  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {workers: [], tasks: [], budget: 0, used: Object.fromEntries(ROLES.map((role) => [role, 0]))};
    }
  }

  function persist(board) {
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(board, null, 2), {mode: 0o600, flag: 'wx'});
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, {force: true});
    }
  }

  function mutate(callback) {
    const operation = queue.then(async () => {
      const board = read();
      const result = await callback(board);
      persist(board);
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  const token = (worker) => crypto.createHmac('sha256', secret)
    .update(`workrooms:${worker.id}:${worker.passwordHash}`).digest('hex');

  function userFor(req, admin, board) {
    if (admin) return {id: '1', name: 'ID 1 · Admin', role: 'admin'};
    const cookie = (req.headers.cookie || '').split(';').map((piece) => piece.trim())
      .find((piece) => piece.startsWith(COOKIE + '='));
    if (!cookie) return null;
    const [id, signature] = cookie.slice(COOKIE.length + 1).split('.');
    const worker = board.workers.find((entry) => entry.id === id);
    return worker && safeEqual(token(worker), signature) ? publicWorker(worker) : null;
  }

  function acceptWorker(board, body, worker) {
    const name = requiredText(body.name, 'a name', 80);
    const email = requiredText(body.email, 'an email address', 200).toLowerCase();
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
    requireThat(ROLES.includes(body.role), 'Choose a worker role.');
    requireThat(!board.workers.some((entry) => entry.email === email && entry.id !== worker?.id),
      'A worker with this email already exists.', 409);
    return {name, email, role: body.role};
  }

  function budgetView(board, role) {
    const budget = {};
    for (const [name, percent] of Object.entries(SHARES)) {
      if (role !== 'admin' && role !== name) continue;
      const amount = board.budget * percent / 100;
      const cap = name === 'debugger' ? Math.ceil(amount) : Math.floor(amount);
      budget[name] = {percent, cap, used: board.used[name]};
    }
    return budget;
  }

  async function git(args, workspace, timeout = 15000) {
    const result = await runProcess('git', args, {cwd: workspace, timeout, max: 128 * 1024});
    requireThat(result.ok, args.includes('push') ? 'GitHub rejected the push. Check the host Git credentials and repository permissions.' : 'Could not read the configured Git workspace.', 409);
    return result.stdout.trim();
  }

  const checkHead = async (task, sha) => {
    requireThat(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha || ''), 'Enter the full commit hash.');
    const head = await git(['rev-parse', 'HEAD'], task.workspace);
    requireThat(head === sha, 'The checked-out commit changed. Submit it for review again.', 409);
    const changes = await git(['status', '--porcelain'], task.workspace);
    requireThat(!changes, 'Commit or set aside changes before reviewing this commit.', 409);
  };

  async function perform(board, user, task, body) {
    if (body.action === 'assign') {
      allow(user, 'admin');
      requireThat(task.phase !== 'pushed', 'This task is closed.', 409);
      const assignee = board.workers.find((worker) => worker.id === body.workerId);
      requireThat(assignee && ROLES.includes(body.role) && assignee.role === body.role, 'Select a worker for this role.');
      task.assignees[body.role] = assignee.id;
      return;
    }
    requireThat(task.phase !== 'pushed', 'This task is closed.', 409);
    if (body.action === 'note') {
      const room = user.role === 'admin' ? body.room : user.role;
      requireThat(ROLES.includes(room), 'Select a room.');
      task.notes[room].push(stamp(user, requiredText(body.note, 'a message'), {recipient: task.assignees[room]}));
      return;
    }
    if (body.action === 'usage') {
      const role = user.role === 'admin' ? body.role : user.role;
      const units = body.units;
      requireThat(ROLES.includes(role) && Number.isSafeInteger(units) && units > 0, 'Enter a positive whole number of units.');
      const {cap, used} = budgetView(board, role)[role];
      requireThat(units <= cap - used, 'This room has reached its usage allowance.', 409);
      board.used[role] += units;
      return;
    }
    if (body.action === 'plan' || body.action === 'design') {
      const role = body.action === 'plan' ? 'planner' : 'designer';
      allow(user, role);
      requireThat(['planning', 'brief-reviewed'].includes(task.phase), 'The brief has already been approved.', 409);
      task[body.action] = stamp(user, requiredText(body.note, 'the handoff'));
      task.briefReview = null;
      task.phase = 'planning';
      return;
    }
    if (body.action === 'review-brief') {
      allow(user, 'debugger');
      requireThat(task.phase === 'planning' && task.plan && task.design && typeof body.pass === 'boolean',
        'Submit both a plan and a design before the brief review.', 409);
      task.briefReview = stamp(user, requiredText(body.note, 'review evidence'), {pass: body.pass});
      if (body.pass) task.phase = 'brief-reviewed';
      return;
    }
    if (body.action === 'approve-brief') {
      allow(user, 'admin');
      requireThat(task.phase === 'brief-reviewed', 'A passing Debugger brief review is required.', 409);
      task.phase = 'implementation';
      return;
    }
    if (body.action === 'submit-commit') {
      allow(user, 'programmer');
      requireThat(['implementation', 'verification', 'needs-fix', 'verified', 'approved-push'].includes(task.phase),
        'Admin must approve the brief first.', 409);
      const sha = requiredText(body.sha, 'a commit hash', 64).toLowerCase();
      await checkHead(task, sha);
      task.implementation = stamp(user, requiredText(body.note, 'implementation notes'), {sha});
      task.verification = null;
      task.approval = null;
      task.phase = 'verification';
      return;
    }
    if (body.action === 'verify') {
      allow(user, 'debugger');
      requireThat(task.phase === 'verification' && typeof body.pass === 'boolean', 'No commit is waiting for verification.', 409);
      const sha = task.implementation.sha;
      requireThat(body.sha === sha, 'The submitted commit changed. Refresh, then verify the new commit.', 409);
      await checkHead(task, sha);
      task.verification = stamp(user, requiredText(body.note, 'test results'), {sha, pass: body.pass});
      task.phase = body.pass ? 'verified' : 'needs-fix';
      return;
    }
    if (body.action === 'approve-push') {
      allow(user, 'admin');
      requireThat(task.phase === 'verified' && task.verification?.pass && task.verification.sha === body.sha,
        'A passing Debugger report for this exact commit is required.', 409);
      await checkHead(task, body.sha);
      task.approval = stamp(user, '', {sha: body.sha});
      task.phase = 'approved-push';
      return;
    }
    if (body.action === 'push') {
      allow(user, 'programmer');
      requireThat(task.phase === 'approved-push' && task.approval?.sha === body.sha &&
        task.verification?.sha === body.sha && task.verification.pass,
      'Admin must approve this exact verified commit before you can push.', 409);
      await checkHead(task, body.sha);
      await git(['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
        'push', '--no-follow-tags', '--recurse-submodules=no', '--', task.remote,
        `${body.sha}:refs/heads/${task.branch}`], task.workspace, 120000);
      task.push = stamp(user, '', {sha: body.sha});
      task.phase = 'pushed';
      return;
    }
    throw new WorkroomError('Unknown workroom action.', 404);
  }

  return async function route(req, res, url, admin, secure) {
    const route = url.pathname.slice('/api/workrooms'.length);
    try {
      if (req.method !== 'GET' && req.headers.origin) {
        const origin = URL.parse(req.headers.origin);
        requireThat(origin?.host === req.headers.host, 'Cross-origin request refused.', 403);
      }
      if (req.method === 'POST' && route === '/login') {
        const ip = 'workrooms:' + req.socket.remoteAddress;
        requireThat(loginAllowed(ip), 'Too many attempts. Wait ten minutes.', 429);
        const body = (await readJson(req, 4096)) || {};
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const worker = read().workers.find((entry) => entry.email === email);
        if (!worker || typeof body.password !== 'string' || !safeEqual(worker.passwordHash, digest(body.password))) {
          noteLoginFailure(ip);
          throw new WorkroomError('Incorrect email or password.', 401);
        }
        res.setHeader('Set-Cookie', `${COOKIE}=${worker.id}.${token(worker)}; HttpOnly; SameSite=Lax; Path=/api/workrooms${secure ? '; Secure' : ''}`);
        return json(res, 200, {user: publicWorker(worker)});
      }
      if (req.method === 'POST' && route === '/logout') {
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/workrooms; Max-Age=0${secure ? '; Secure' : ''}`);
        return json(res, 200, {ok: true});
      }
      const board = read();
      const user = userFor(req, admin, board);
      requireThat(user, 'Sign in to a workroom.', 401);
      if (req.method === 'GET' && route === '/view') {
        const tasks = board.tasks.filter((task) => user.role === 'admin' || task.assignees[user.role] === user.id);
        const requested = url.searchParams.get('task');
        const task = requested ? tasks.find((entry) => entry.id === requested) : tasks[0];
        requireThat(!requested || task, 'This workroom is not assigned to you.', 404);
        return json(res, 200, {
          user, tasks: tasks.map(publicTask), task: task ? visibleTask(task, user) : null,
          budget: budgetView(board, user.role),
          ...(user.role === 'admin' ? {workers: board.workers.map(publicWorker), budgetTotal: board.budget} : {}),
        });
      }
      if (req.method !== 'POST') throw new WorkroomError('Unknown workroom route.', 404);
      const body = (await readJson(req, 64 * 1024)) || {};
      const result = await mutate(async (fresh) => {
        const actor = userFor(req, admin, fresh);
        requireThat(actor, 'Your workroom access has expired.', 401);
        if (route === '/workers') {
          allow(actor, 'admin');
          const worker = fresh.workers.find((entry) => entry.id === body.id);
          if (body.action === 'create') {
            const password = crypto.randomBytes(24).toString('base64url');
            const created = {id: crypto.randomUUID(), ...acceptWorker(fresh, body), passwordHash: digest(password)};
            fresh.workers.push(created);
            return {worker: publicWorker(created), password};
          }
          requireThat(worker, 'No such worker.', 404);
          if (body.action === 'update') {
            Object.assign(worker, acceptWorker(fresh, body, worker));
          } else if (body.action === 'reset') {
            const password = crypto.randomBytes(24).toString('base64url');
            worker.passwordHash = digest(password);
            return {worker: publicWorker(worker), password};
          } else if (body.action === 'remove') {
            fresh.workers = fresh.workers.filter((entry) => entry !== worker);
          } else throw new WorkroomError('Unknown worker action.');
          return {ok: true};
        }
        if (route === '/budget') {
          allow(actor, 'admin');
          requireThat(Number.isSafeInteger(body.total) && body.total >= 10 && body.total <= 1_000_000_000,
            'Enter a budget between 10 and 1,000,000,000 units.');
          fresh.budget = body.total;
          const limits = budgetView(fresh, 'admin');
          requireThat(ROLES.every((role) => limits[role].used <= limits[role].cap),
            'The new budget cannot be lower than already reported usage.', 409);
          return {ok: true};
        }
        if (route === '/tasks') {
          allow(actor, 'admin');
          const workspace = path.resolve(requiredText(body.workspace, 'a workspace path', 2048));
          const branch = requiredText(body.branch, 'a destination branch', 180);
          requireThat(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch), 'Enter a valid Git branch.');
          await git(['check-ref-format', `refs/heads/${branch}`], workspace);
          const remote = await git(['remote', 'get-url', '--push', 'origin'], workspace);
          requireThat(/^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(remote),
            'Configure origin as a GitHub repository without credentials in the URL.');
          const assignees = {};
          for (const role of ROLES) {
            const worker = fresh.workers.find((entry) => entry.id === body.assignees?.[role] && entry.role === role);
            requireThat(worker, `Assign a ${role} to this task.`);
            assignees[role] = worker.id;
          }
          const task = {
            id: crypto.randomUUID(), title: requiredText(body.title, 'a title', 120),
            brief: requiredText(body.brief, 'a shared brief'), workspace, branch, remote, assignees,
            phase: 'planning', notes: Object.fromEntries(ROLES.map((role) => [role, []])),
          };
          fresh.tasks.unshift(task);
          return {task: publicTask(task)};
        }
        if (route === '/action') {
          const task = fresh.tasks.find((entry) => entry.id === body.taskId);
          requireThat(task, 'No such task.', 404);
          visibleTask(task, actor);
          await perform(fresh, actor, task, body);
          return {ok: true};
        }
        throw new WorkroomError('Unknown workroom route.', 404);
      });
      return json(res, 200, result);
    } catch (error) {
      const expected = error instanceof WorkroomError;
      const status = expected ? error.status : error instanceof SyntaxError ? 400 : 500;
      return json(res, status, {error: expected ? error.message : 'The workroom request could not be completed.'});
    }
  };
}
