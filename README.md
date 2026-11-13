# TheChambers

Formally known as cmdc. The workflow is adapted from prior art, rebuilt from scratch for
[Command Code](https://commandcode.ai).

**Drive Command Code from your phone.** TheChambers is a small, dependency-free web app that runs
on your machine, binds to your Tailscale address, and gives you a chat interface for the `cmdc`
CLI — with live streaming, your real projects, and your real sessions.

It does not re-implement an agent. It spawns Command Code headless (`cmdc -p`), streams the
frames to the browser, and reads Command Code's own session transcripts, so what you see is the
same work the CLI did.

---

## Why

Command Code is a terminal agent. That is great at a desk and awkward on a phone. TheChambers
gives you the terminal's work in a browser tab on your phone, over your private tailnet, without
opening a port to the internet:

- **No tunnel, no public URL.** The server binds the Tailscale address and loopback only.
- **No duplicate state.** Sessions come from `~/.commandcode/projects/`, not a parallel database.
- **No background service to babysit.** Start it when you need it, Ctrl+C when you do not.

## Features

| | |
| --- | --- |
| **Chat with streaming** | Token-level streaming over SSE, markdown rendering, collapsible tool calls with their output |
| **Real sessions** | Lists the actual session files on disk; resumes the active branch of the conversation tree |
| **Projects** | Every folder Command Code already has sessions for, plus any folder you add by path |
| **Terminal bridge** | A message sent here continues the same session id, so a terminal and the phone share one conversation |
| **Live indicator** | Marks sessions being written right now (`● live now`) and warns when two writers share a session |
| **Permission modes** | Read-only by default; Full access (`--yolo`) when you need edits and shell commands |
| **Password gate** | One password, per-device trusted cookies, rate-limited attempts, strict CSP |
| **Zero dependencies** | Plain Node 22+ and four static files. Nothing to `npm install` |

## Requirements

- **Node.js 22 or newer** (`node --version`)
- **Command Code CLI**, installed and signed in:
  ```
  npm i -g command-code@latest
  cmd login
  cmd status
  ```
- **Tailscale**, running on this machine and on the phone you will use
- Windows 10/11, macOS, or Linux (the launchers are PowerShell; on macOS/Linux run `node server.mjs`)

## Install

```bash
git clone https://github.com/shawnradam/TheChambers.git
cd TheChambers
```

There is no build step and no `npm install`.

### Windows

Double-click **start-thechambers.bat**, or:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-thechambers.ps1
```

Options:

```powershell
.\start-thechambers.ps1 -Workspace "C:\path\to\project"   # default folder for new chats
.\start-thechambers.ps1 -Port 3003                        # if 3002 is taken
.\start-thechambers.ps1 -Local                            # loopback only, no phone access
```

Run `.\create-shortcut.ps1` once to get `TheChambers.lnk` for one-click starting.

### macOS / Linux

```bash
THECHAMBERS_WORKSPACE="$HOME/code" node server.mjs
```

The server prints the address it bound to. Use `THECHAMBERS_HOST=127.0.0.1` to keep it local.

## Reach it from your phone

The start-up log prints the address. By default:

| Device | Address |
| --- | --- |
| Phone, anywhere | `http://<tailscale-ip>:3002` |
| Phone, by name | `http://<machine>.<tailnet>.ts.net:3002` (needs MagicDNS) |
| This machine | `http://127.0.0.1:3002` |

Both phone addresses need **Tailscale running on the phone**. Nothing is exposed to the internet
or to the local network: the listeners bind the Tailscale address and `127.0.0.1` only.

### First sign-in

The password lives outside the repository:

| OS | Path |
| --- | --- |
| Windows | `%USERPROFILE%\.config\thechambers\ui-password.txt` |
| macOS / Linux | `~/.config/thechambers/ui-password.txt` |

Generated with 24 random bytes on first run if missing. Paste it on the phone once and keep
**Trust this device** ticked (30-day cookie). Ten wrong attempts lock that address out for ten
minutes.

To rotate it, replace the file's contents and restart the server. All devices will be asked again.

## Using it

The interface follows prior art's layout: a 280px sidebar, a centered hero on an empty session,
and one composer that follows you into the conversation.

### Sidebar

- **Chats** — conversations this app tracks, most recent first. The sidebar shows the active one
  and a green dot while a turn is running.
- **In work** — appears only while something is running, so you can jump back to it.
- **Projects** — every working directory Command Code has sessions for, with a session count.
  Click one to expand it: each nested row is a real session file, newest first, and anything
  written in the last two minutes is marked with a green dot. Tap a session to resume it with its
  full transcript. **+** adds a folder by full path.

The magnifier filters chats and sessions by text; the panel icon collapses the sidebar.

### Composer

- Placeholder: *Plan, build, or ask.* Enter sends on a physical keyboard; on touch devices the
  arrow button does.
- **Read-only / Full access** chip on the left of the composer bar.
- The model in use appears next to it once the first frame arrives.
- In an empty session, the six suggestion chips under the composer seed a prompt
  (explore the codebase, catch me up, weigh my options, plan a feature, debug an issue, review
  changes).
- **Stop** kills the whole process tree. Everything that had already committed stays on disk.

### Permission modes

- **Read-only** (default) — reads, searches, explains. Headless Command Code denies file writes
  and shell commands, so nothing on the machine changes.
- **Full access** — passes `--yolo`: edits files and runs commands with no approval prompt. There
  is no confirmation step in the web UI, so treat this as "yes, do it".

## One session, two views

Command Code has no attach API: a running terminal holds its conversation in memory and writes the
transcript to disk as each turn commits. TheChambers bridges at that file.

```
   terminal (cmdc)                      phone (TheChambers)
        │                                      │
        ├── writes turn ──► transcript ◄── polls every 2.5s
        │                                      │
        └── ◄── /resume reloads ────────────── sends a turn (--resume <same id>)
```

- **Terminal → phone** works on its own. Finish a turn in the terminal and it appears here on the
  next poll. The **live** pill shows up while another process is writing.
- **Phone → terminal** lands in the same session file. The terminal will not display it until you
  run `/resume` and pick that session — it cannot be pushed a message while it runs.
- **Never type in both at once.** Two writers on one transcript produce two branches of the same
  session. Nothing is corrupted, but the history forks. Finish in one place before using the other.

Sessions created here are ordinary Command Code sessions: `cmd -r`, `/resume`, `/tree`, `/export`
and `/rewind` all see them.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `THECHAMBERS_HOST` | Tailscale IPv4, else `127.0.0.1` | Address to bind |
| `THECHAMBERS_PORT` | `3002` | Port to bind (3000 is a typical dev server, 3001 prior art) |
| `THECHAMBERS_WORKSPACE` | home directory | Default folder for new chats |
| `THECHAMBERS_MAX_TURNS` | `60` | `--max-turns` passed to headless runs |
| `CMDC_ENTRY` | auto-detected | Path to `command-code/dist/index.mjs` if it is not in the global npm prefix |

The older `CMDC_WEB_*` names are still accepted as fallbacks.

State lives in `%USERPROFILE%\.config\thechambers\` (or `~/.config/thechambers/`):

| File | Contents |
| --- | --- |
| `ui-password.txt` | The unlock password |
| `secret.txt` | HMAC key for session cookies |
| `conversations.json` | Chat metadata only — titles, project, session id. Messages are never duplicated here |

Back up the first two if you want to keep passwords and logins; the third is disposable.

## API

All endpoints except `/health` and `/login` require the session cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness: version, workspace, running count |
| `POST` | `/api/login` | `{password, trust}` → sets the cookie |
| `POST` | `/api/logout` | Clears the cookie |
| `GET` | `/api/state` | Conversations, workspaces, host, port, running ids |
| `GET` | `/api/projects` | Working directories with session counts and last use |
| `POST` | `/api/workspaces` | `{path}` → adds a folder to the project list |
| `GET` | `/api/sessions?workspace=` | Session files on disk, with an `active` flag |
| `POST` | `/api/sessions/resume` | `{sessionId}` → conversation bound to that session |
| `GET` | `/api/conversations/:id` | Conversation plus messages read from the transcript |
| `POST` | `/api/conversations` | `{workspace, title}` → new chat |
| `DELETE` | `/api/conversations/:id` | Forget a chat (the session file is left alone) |
| `POST` | `/api/turn` | `{conversationId?, workspace?, text, mode}` → SSE stream |
| `POST` | `/api/stop` | `{conversationId}` → kill the running turn |

`/api/turn` returns `text/event-stream`. Frames are `{t: 'start' | 'text' | 'tool' | 'model' |
'error' | 'done', ...}`.

## Verify it works

```bash
node tools/verify.mjs http://127.0.0.1:3002
node tools/verify.mjs http://<tailscale-ip>:3002
```

Twelve checks: the wrong password is refused, the right one unlocks, state is closed to
strangers, projects include the launch folder, sessions are read from disk, resuming opens a
conversation with its transcript, and a real turn streams text and finishes with a session id.
The last check runs the agent, so it costs a small amount of credit.

## How it works

```
browser  ──POST /api/turn──►  server.mjs  ──spawn──►  node <cmdc entry> -p --output-format json
   ▲                              │                        │
   └───── SSE data frames ◄───────┘ ◄──── NDJSON frames ───┘
```

Three decisions worth knowing if you modify it:

**The prompt travels on stdin, never as an argument.** Windows needs a shell to launch the `cmdc`
shim, so the server runs the bundled entry point with the same `node` binary and writes the
message to stdin. No user text can reach an argument list.

**History is not stored twice.** Conversation metadata is local; every message is parsed from the
transcript, cached by file mtime and size so polling a multi-megabyte session stays cheap. The
parser walks the parent chain from the newest entry, which is the same active-branch rule
`/tree` and `/rewind` use.

**Streaming is SSE.** A turn is one long-lived HTTP response with a 15-second heartbeat so mobile
networks do not drop idle connections. If the phone leaves mid-run, the run still finishes and the
transcript is the record.

Security posture: the cookie is an HMAC of the password (the password itself is never stored in
the browser), login attempts are rate-limited per address, JSON bodies are capped at 1 MB, prompts
are capped at 40,000 characters, transcripts are read-only, and every page is served with a strict
`Content-Security-Policy` and no inline script. Cross-origin `POST /api/turn` is refused.

## Project layout

```
server.mjs               HTTP server: auth, session catalog, transcripts, SSE, static files
public/index.html        Chat page
public/app.js            Streaming client, live polling, markdown, tool chips
public/styles.css        Dark, phone-first styles
public/login.html        Password gate
public/login.js          Login form
start-thechambers.ps1    Windows launcher (Tailscale address, port check, password bootstrap)
start-thechambers.bat    Double-click wrapper
create-shortcut.ps1      Creates TheChambers.lnk
tools/verify.mjs         End-to-end check
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Port 3002 is already in use by …` | Another app owns it. Start with `-Port 3003` (Windows) or `THECHAMBERS_PORT=3003` |
| `Tailscale is not running…` | Start Tailscale, or use `-Local` / `THECHAMBERS_HOST=127.0.0.1` |
| Phone cannot reach the server | Phone's Tailscale is off, or MagicDNS is disabled and you used the name. Use the `100.x` address |
| A phone message is not in the terminal | Expected: run `/resume` in the terminal and pick that session |
| The live pill keeps appearing | Another process or tab is writing to the same session — the fork warning |
| Files do not change | You are in Read-only. Switch to Full access and resend |
| `Could not start Command Code` | The CLI is not where the server expects. The log prints the resolved path; reinstall `command-code` globally or set `CMDC_ENTRY` |
| Asked for the password again | Trust this device was unticked, or the 30-day cookie expired. Replace `secret.txt` to rotate sessions |
| A turn hangs | Press Stop; the process tree is killed and the transcript keeps what committed |

## Limitations

- One turn at a time per conversation (the CLI has no multiplexed session).
- The terminal cannot be pushed a message; `/resume` is the handoff.
- No file browser or diff viewer yet — tool output is shown inside the chat.
- Tailscale is assumed; there is no TLS of its own, which is why the server refuses to bind a
  public interface by default.

## License

MIT. Command Code itself is a separate product with its own terms; this project only drives it.
