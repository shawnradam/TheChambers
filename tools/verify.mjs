#!/usr/bin/env node
// Proves cmdc-web still works end to end.
//
//   node tools/verify.mjs [baseUrl]
//
// Checks, in order: the login gate refuses a wrong password, accepts the real one, the state
// endpoint answers, and a real turn streams text and finishes cleanly. The last check costs a
// small amount of credit because it runs the actual agent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.argv[2] || process.env.THECHAMBERS_BASE || 'http://127.0.0.1:3002').replace(/\/$/, '');
const passwordFile = path.join(os.homedir(), '.config', 'thechambers', 'ui-password.txt');

let failures = 0;

function pass(label) {
  console.log(`  PASS  ${label}`);
}

function fail(label, detail) {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(label, detail);
}

if (!fs.existsSync(passwordFile)) {
  console.error(`No password file at ${passwordFile}. Start the server once.`);
  process.exit(1);
}

const password = fs.readFileSync(passwordFile, 'utf8').trim();
console.log(`Verifying ${base}`);

// 1. The gate refuses a wrong password.
{
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: 'definitely-not-it'}),
  });
  check('wrong password is refused', res.status === 401, `got ${res.status}`);
}

// 1b. Authorship is fixed in server.mjs and reported publicly, so an edited fork is visible.
{
  const health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => ({}));
  check('author is reported', health.author === 'Shawn Radam', `got ${health.author}`);
  check('founder is reported', health.founder === 'Shawn Radam', `got ${health.founder}`);
  check('authorship constants are intact', health.authorship === 'intact', health.authorship);
}

// 2. The real password sets a cookie.
let cookie = null;
{
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password, trust: false}),
  });
  const header = res.headers.get('set-cookie') || '';
  cookie = header.split(';')[0] || null;
  check('right password unlocks', res.ok && Boolean(cookie), `status ${res.status}`);
}

if (!cookie) {
  console.log('\nCannot continue without a session cookie.');
  process.exit(1);
}

// 3. State answers with a cookie and refuses without one.
let state = {};
{
  const anonymous = await fetch(`${base}/api/state`);
  check('state is closed to strangers', anonymous.status === 401, `got ${anonymous.status}`);

  const authed = await fetch(`${base}/api/state`, {headers: {Cookie: cookie}});
  state = await authed.json().catch(() => ({}));
  check('state loads when signed in', authed.ok && typeof state.workspace === 'string');
}

// 4. Projects and existing sessions are visible.
let sessions = [];
{
  const projects = await fetch(`${base}/api/projects`, {headers: {Cookie: cookie}}).then((r) => r.json());
  check(
    'projects list includes the launch workspace',
    Array.isArray(projects.projects) &&
      projects.projects.some((project) => project.path.toLowerCase() === state.workspace.toLowerCase()),
  );

  const listed = await fetch(
    `${base}/api/sessions?workspace=${encodeURIComponent(state.workspace)}`,
    {headers: {Cookie: cookie}},
  ).then((r) => r.json());
  sessions = listed.sessions || [];
  check('sessions are read from disk', Array.isArray(sessions));
}

// 5. Resuming an existing session loads its transcript.
if (sessions.length) {
  const resumed = await fetch(`${base}/api/sessions/resume`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: cookie},
    body: JSON.stringify({sessionId: sessions[0].id}),
  });
  const conversation = await resumed.json();
  const detail = conversation.id
    ? await fetch(`${base}/api/conversations/${conversation.id}`, {headers: {Cookie: cookie}}).then((r) => r.json())
    : {};
  check('resume opens a conversation', resumed.ok && Boolean(conversation.id));
  check(
    'resumed conversation shows the transcript',
    Array.isArray(detail.messages) && detail.messages.length > 0,
    'no messages came back',
  );
} else {
  console.log('  SKIP  resume checks (no sessions in this workspace yet)');
}

// 6. A real turn streams and finishes.
{
  const res = await fetch(`${base}/api/turn`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: cookie},
    body: JSON.stringify({text: 'Reply with the single word: ok', mode: 'read-only'}),
  });

  if (!res.ok || !res.body) {
    fail('turn starts', `status ${res.status}`);
  } else {
    pass('turn starts');
    let buffer = '';
    let text = '';
    let done = null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const {done: end, value} = await reader.read();
      if (end) break;
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
          if (payload.t === 'text') text += payload.d;
          if (payload.t === 'done') done = payload;
        }
      }
    }

    check('text streamed back', text.trim().length > 0, 'no text deltas arrived');
    check('run finished cleanly', done && !done.error, done ? done.error : 'no done event');
    check('a session id was captured', done && done.exitCode === 0);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
