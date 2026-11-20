# server.mjs

The whole backend: one dependency-free Node 22 file. It serves the interface, talks to the active
agent adapter, and keeps state in `~/.config/thechambers/`.

## Boot sequence

1. Read `~/.config/thechambers/` (password, secret, conversations, notes, settings, usage).
2. Create the password and secret if missing (`ui-password.txt`, `secret.txt`, both 0600 on Unix).
3. Load providers (`providers/index.mjs`) and select the active one: `THECHAMBERS_PROVIDER` →
   `settings.json:provider` → `cmdc`.
4. Resolve the bind address: `THECHAMBERS_HOST` → Tailscale IPv4 → `127.0.0.1`. Refuse to be quiet
   about it when the address is neither loopback nor the tailnet.
5. Listen on the resolved address and, when it is not loopback, on `127.0.0.1` as well.

Request and socket timeouts are disabled on purpose: a turn can stream for many minutes.

## Authentication

- `POST /api/login {password, trust}` sets `thechambers=<HMAC>`; the token is
  `HMAC(secret, "thechambers-session-v1:" + password)`, so rotating the password signs every device
  out. `secret.txt` rotates the sessions without touching the password.
- Cookie is `HttpOnly; SameSite=Lax; Path=/`, 30 days when the device is trusted.
- Ten wrong attempts lock an address out for ten minutes.
- Every non-GET `/api/*` call also checks `Origin` against `Host`.
- Pages are served with a strict CSP, `nosniff`, no inline script.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | version, commit, host, workspace, running, author/authorship |
| GET | `/` | chat page (redirects to `/login` when unauthenticated) |
| POST | `/api/login`, `/api/logout` | session cookie |
| GET | `/api/state` | conversations, workspaces, provider, providers, running ids |
| GET/POST | `/api/providers` | list adapters; switch the default (restart to take effect) |
| GET | `/api/projects` | working directories derived from the provider's sessions |
| GET/POST | `/api/workspaces` | list/add a folder |
| GET | `/api/sessions` | provider sessions for a workspace, with `active` |
| POST | `/api/sessions/resume` | create a conversation bound to a session id |
| GET | `/api/conversations/:id` | conversation + transcript from the provider + `externalActive` |
| DELETE | `/api/conversations/:id` | forget a chat (session file untouched) |
| POST | `/api/turn` | SSE stream for one turn |
| POST | `/api/stop` | kill the turn's process tree |
| GET | `/api/usage?days=7` | aggregated tokens/cost per day and conversation |
| GET | `/api/update`, POST `/api/update/apply` | check GitHub, fast-forward if clean |
| GET/POST | `/api/settings` | auto-check/auto-update, provider |
| POST | `/api/uploads` | base64 image/file, 12 MB cap, newest 200 kept |
| GET | `/api/uploads/:name` | authenticated file with `default-src 'none'` |
| GET | `/api/models` | provider `command()` + `--list-models` |
| GET | `/api/notes`, `/api/files`, `/api/file`, `/api/diff`, `/api/git`, `/api/search`, `/api/exec` | workspace panels |

## A turn

`POST /api/turn {conversationId?, workspace?, text, mode, model?, effort?, concise?}`

1. Creates or finds the conversation, stores `provider`, `concise`, `model`.
2. `args = PROVIDER.turnArgs(...)`; `child = PROVIDER.spawn(args, cwd)`.
3. The prompt goes in on **stdin** — never argv, so nothing typed on a phone reaches a shell.
4. Stopping uses `taskkill /T /F` on Windows, `SIGTERM` elsewhere.
5. Each stdout line is JSON-parsed and passed to `PROVIDER.parse()`, whose normalized events
   (`text`, `tool`, `model`, `session`, `usage`, `final`, `error`, `done`) become SSE frames.
6. On finish: session id and usage are recorded, the provider index is invalidated, and the user/
   assistant messages are recoverable from the agent's own transcript.

SSE heartbeat every 15s, attached to the **response** close event (not the request), which is what
keeps long turns from being dropped by mobile networks.

**One turn per session.** `running` holds one record per conversation. A second `POST /api/turn` for a
conversation already running is refused with `409` before any headers are written — it must not spawn a
second agent process on the same transcript, and it must not overwrite the record, because the map is
the only handle `/api/stop` has on the child. The client serialises its sends through one gate and
holds anything typed meanwhile, so the 409 is a backstop, not the normal path.

## Concise mode

Per conversation. When on, the message is prefixed with a visible `[concise mode]` preamble aimed
at output verbosity and repeated tool work. Honest expectation: 10–20% typical, more on chatty
sessions, little on large refactors — the agent's system prompt is outside our control.

## State files

| File | Contents |
| --- | --- |
| `ui-password.txt` | the unlock password |
| `secret.txt` | HMAC key for cookies |
| `conversations.json` | chat metadata only — title, workspace, session id, provider, concise |
| `usage.json` | last 2000 turns: input/output/cache/cost, per conversation |
| `settings.json` | provider, update preferences, last check |
| `uploads/` | pasted files; newest 200 kept |
| `server.log` | request failures and uncaught exceptions (1 MB rotation) |

## Changelog

### 2026-11-21
- Fixed malformed request URLs and non-object login bodies to return HTTP 400.
- Authentication reads the session cookie directly, so unrelated cookies do not affect sign-in.

### 2026-11-20 — Hold and Steer, one turn per session
- Fixed: `/api/turn` accepted a second concurrent turn for the same conversation and overwrote the
  `running` record, orphaning the first child (un-stoppable) and letting two agent processes write one
  transcript. It now returns 409 before headers, and the client sends through a single gate
- Verified: two dispatches in one tick produce one 200 and no second POST; steer plus two held messages
  produce four sequential 200s; `tools/verify.mjs` 15/15

### 2026-11-14 — 9b647a1
- Changed: all Command Code specifics moved to `providers/cmdc.mjs`; `/api/providers` added
- Why: support more than one agent without forking the server
- Verified: verify.mjs 15/15, provider-check cmdc

### 2026-11-14 — 2e0a34c
- Added: `/api/usage`, `concise` on conversations, image downscale on the client
- Why: make token saving measurable and real

### 2026-11-13 — 90ff1fd
- Changed: session cookie derived from password + secret
- Why: rotating the password actually signs devices out, as documented

### 2026-11-13 — 3e61628
- Added: same-origin guard on every non-GET `/api/*`; warning when bound off-tailnet
- Why: defence in depth; avoid plaintext passwords on a LAN

### 2026-11-13 — 05a2870
- Fixed: malformed JSON bodies return 400 instead of 500 and stay out of the log
