# Providers — teaching TheChambers a new agent

TheChambers is a phone front end for **a coding-agent CLI**. It does not contain an agent. Every
agent-specific detail lives in one file: how a turn is launched, how its output is parsed, where
its sessions live, and how a transcript is read.

- `providers/cmdc.mjs` — Command Code, the reference implementation and the default.
- `providers/_template.mjs` — copy this to start a new adapter.
- `providers/index.mjs` — the registry: built-ins plus drop-ins.

**This is not affiliated with Command Code.** Adding an adapter does not imply
endorsement by that agent's vendor.

---

## Where adapters live

| Location | Scope |
| --- | --- |
| `providers/<id>.mjs` | shipped with the project |
| `~/.config/thechambers/providers/<id>.mjs` | yours, loaded at boot, no fork needed |

Selection order: `THECHAMBERS_PROVIDER` env → `provider` in `~/.config/thechambers/settings.json`
→ `cmdc`. Switching from the UI writes the setting; it takes effect on the next start.

## The contract

A provider is a default-exported object. Only `id`, `turnArgs`, `spawn`, `parse` are mandatory;
the rest degrade to "not supported".

```js
export default {
  id: 'cmdc',              // unique, lowercase, stable
  label: 'Command Code',   // shown in the UI
  docs: 'https://…',       // optional

  capabilities: {resume: true, transcripts: true, liveSessions: true},

  modes: [
    {id: 'read-only', label: 'Read-only'},
    {id: 'full', label: 'Full access', flags: ['--yolo']},
  ],

  available(),              // → {ok, detail}   cheap, never throws
  command(),                // → {file, args}   optional; for --list-models style calls
  turnArgs({sessionId, mode, model, effort, maxTurns}),  // → string[]
  spawn(args, cwd),         // → ChildProcess with pipeable stdio
  parse(frame),             // → event | event[] | null
  sessions({workspace, limit}),  // → [{id,title,cwd,model,createdAt,updatedAt,active}]
  transcript(sessionId),    // → [{role,text,tools,ts}]
  invalidate(),             // optional; after a turn
};
```

### The two rules

1. **User text never goes in argv.** The server writes the prompt to the child's stdin. You may
   put session ids, model ids and whitelisted flags in `turnArgs`, nothing typed by a person.
2. **No dependencies.** An adapter may use `node:` built-ins and nothing else. If it needs a
   library, that is a design issue to raise, not a package to add.

### Normalized events

`parse()` receives one already-JSON-parsed line from stdout and returns events the app
understands. Unknown frames stay unknown — never throw on them, or a vendor's new event type
breaks the stream.

| Event | Meaning |
| --- | --- |
| `{type:'text', text}` | assistant text delta |
| `{type:'tool', id, name, status, input?, description?, result?}` | tool start/finish; `status` is `queued`, `running`, `done`, `denied`, `error` |
| `{type:'model', model}` | the model actually serving the turn |
| `{type:'session', sessionId}` | the session id to resume next turn |
| `{type:'usage', usage}` | token usage for the turn |
| `{type:'final', text}` | authoritative final text |
| `{type:'error', message}` | a failed turn |
| `{type:'done', subtype?}` | run finished |

### Sessions and transcripts

`sessions()` powers the Projects and Sessions panels: return the agent's real sessions on disk,
newest first, with `active: true` when the file was written in the last couple of minutes (that is
how the app spots the terminal session you are sitting in). `transcript()` must return the
**active branch** only — the CLI equivalent of "what you see now", not every branch in the file.

## Worked example: Claude Code

This is the shape a real adapter takes. It is intentionally short; adjust flags to the version you
have installed and test with `tools/provider-check.mjs`.

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';

const ROOT = path.join(os.homedir(), '.claude', 'projects');

export default {
  id: 'claude',
  label: 'Claude Code',
  capabilities: {resume: true, transcripts: true, liveSessions: true},
  modes: [
    {id: 'read-only', label: 'Read-only', flags: ['--permission-mode', 'plan']},
    {id: 'full', label: 'Full access', flags: ['--dangerously-skip-permissions']},
  ],

  available() {
    try {
      const out = execFileSync('claude', ['--version'], {encoding: 'utf8', timeout: 10000}).trim();
      return {ok: true, detail: out};
    } catch {
      return {ok: false, detail: 'claude is not installed'};
    }
  },

  turnArgs({sessionId, mode}) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (sessionId) args.push('--resume', sessionId);
    const declared = this.modes.find((entry) => entry.id === mode);
    if (declared && declared.flags) args.push(...declared.flags);
    return args;
  },

  spawn(args, cwd) {
    return spawn('claude', args, {cwd, stdio: ['pipe', 'pipe', 'pipe']});
  },

  parse(frame) {
    // Adjust to the frame names your version emits; ignore what you do not know.
    if (frame.type === 'assistant' && frame.message && frame.message.content) {
      return frame.message.content
        .filter((part) => part.type === 'text')
        .map((part) => ({type: 'text', text: part.text}));
    }
    if (frame.type === 'result') {
      return [
        {type: 'session', sessionId: frame.session_id},
        {type: 'final', text: frame.result || ''},
        {type: 'done'},
      ];
    }
    return [];
  },

  sessions({limit = 200} = {}) {
    const found = [];
    let dirs = [];
    try {
      dirs = fs.readdirSync(ROOT);
    } catch {
      return [];
    }
    for (const dir of dirs) {
      const full = path.join(ROOT, dir);
      let files = [];
      try {
        files = fs.readdirSync(full);
      } catch {
        continue;
      }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(full, name);
        const stat = fs.statSync(file);
        found.push({
          id: name.replace(/\.jsonl$/, ''),
          title: '',
          cwd: decodeURIComponent(dir),
          model: null,
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtimeMs,
          active: Date.now() - stat.mtimeMs < 120000,
        });
      }
    }
    return found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  },

  transcript(sessionId) {
    // Read the JSONL, follow the parent chain, return [{role,text,tools,ts}].
    return [];
  },
};
```

Copy `providers/_template.mjs` rather than this snippet when you start; it has every hook marked.

## Checklist before opening a PR

- [ ] `id` is unique and lowercase; `label` is human
- [ ] `available()` never throws and returns a useful `detail`
- [ ] `turnArgs()` contains no user text
- [ ] `parse()` ignores unknown frames and never throws
- [ ] `sessions()` returns `active` for recently written files
- [ ] `transcript()` returns the active branch only
- [ ] `provider-check` passes, and a real turn streams text
- [ ] one file, `node:` imports only

## Testing

```bash
thechambers providers                 # is it loaded, is it available?
node tools/provider-check.mjs claude  # availability + a real throwaway turn
thechambers --provider claude --local # run the app against it
node tools/verify.mjs http://127.0.0.1:3002
```

`provider-check` starts the adapter directly (no server), sends a one-line prompt, and prints the
normalized events it received. If it shows text and a session id, the adapter is wired correctly.

## Changelog

### 2026-11-14 — 9b647a1
- Added: the contract, the normalized event vocabulary, the Claude Code worked example, the
  checklist, and `tools/provider-check.mjs`
- Why: adding an agent must be one file, not a fork; and every agent's output must map onto the same
  events the interface already renders
- Verified: `provider-check cmdc` streams "ready" with zero parse errors; `verify.mjs` 15/15

