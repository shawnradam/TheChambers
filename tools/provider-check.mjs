#!/usr/bin/env node
// Checks a provider adapter without starting the app:
//
//   node tools/provider-check.mjs            # list every adapter and its availability
//   node tools/provider-check.mjs cmdc       # availability + a real throwaway turn
//
// The turn costs a small amount of credit because it runs the agent for real.

import process from 'node:process';
import {loadProviders, selectProvider, describeProviders} from '../providers/index.mjs';

const id = process.argv[2];
const providers = await loadProviders();

if (!id) {
  const described = describeProviders(providers, null);
  for (const provider of described) {
    console.log(
      `${provider.available ? '  ok  ' : '  !!  '}${provider.id.padEnd(12)} ${provider.label}${provider.detail ? `  — ${provider.detail}` : ''}`,
    );
  }
  console.log(`\n${providers.length} adapter(s). Run with an id to try a turn.`);
  process.exit(0);
}

const provider = selectProvider(providers, id);
if (provider.id !== id) {
  console.error(`No provider called '${id}'. Known: ${providers.map((p) => p.id).join(', ')}`);
  process.exit(2);
}

const availability = provider.available ? provider.available() : {ok: true, detail: 'no check'};
console.log(`${provider.id}: ${availability.ok ? 'available' : 'unavailable'}${availability.detail ? ` — ${availability.detail}` : ''}`);
if (!availability.ok) process.exit(1);

const mode = (provider.modes && provider.modes[0] && provider.modes[0].id) || 'read-only';
const args = provider.turnArgs({mode, maxTurns: 2});
console.log(`args: ${args.join(' ')}`);

const child = provider.spawn(args, process.cwd());
let buffer = '';
const events = [];

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    let parsed = [];
    try {
      parsed = provider.parse(frame) || [];
    } catch (err) {
      events.push({type: 'parse-error', message: err.message});
      continue;
    }
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
      if (event) events.push(event);
    }
  }
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-2000);
});

child.stdin.on('error', () => {});
child.stdin.end('Reply with the single word: ready');

const code = await new Promise((resolve) => child.on('close', resolve));
await new Promise((resolve) => setTimeout(resolve, 50));

const count = (type) => events.filter((event) => event.type === type).length;
const text = events.filter((event) => event.type === 'text').map((event) => event.text).join('');
const session = events.find((event) => event.type === 'session');

console.log(`exit: ${code}`);
console.log(`events: text=${count('text')} tool=${count('tool')} session=${count('session')} usage=${count('usage')} error=${count('error')} parse-error=${count('parse-error')}`);
if (text) console.log(`text: ${text.trim().slice(0, 160)}`);
if (session) console.log(`session: ${session.sessionId}`);
if (stderr.trim()) console.log(`stderr: ${stderr.trim().split('\n').slice(-3).join('\n')}`);

const ok = code === 0 && count('parse-error') === 0 && (count('text') > 0 || count('final') > 0);
console.log(ok ? '\nPASS — the adapter streams text and parses cleanly.' : '\nFAIL — see the counts above.');
process.exit(ok ? 0 : 1);
