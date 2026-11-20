# TheChambers

> ### Unofficial — read this first
>
> TheChambers is a **personal project**, not an official terminal or client for
> [Command Code](https://commandcode.ai). It is **not affiliated with, endorsed by, or supported
> by** Command Code or prior art.
>
> Command Code already has its own remote control, and it runs on Telegram. **I don't use
> Telegram, and this project has nothing to do with that one.** I built TheChambers for my own
> projects, on my own machines, and I am sharing it in case it saves someone else the same work.
> Please don't report problems with it to the Command Code team.
>
> The interface is **inspired by [prior art](https://github.com)**, which
> I love using every day — the layout, the panels and the interaction model are modelled on it.
> All credit for that design is theirs. This is a reimplementation for Command Code, not a fork.

**Full documentation:** [docs/THE-CHAMBERS.md](./docs/THE-CHAMBERS.md) — one document covering
install, use, agents, plugins, the server, the CLI, checks and security. Area references live next to
their code (`server.md`, `bin/README.md`, `public/README.md`, `providers/README.md`,
`plugins/README.md`, `tools/README.md`).

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
| **Workspace panels** | Git status and diffs, a file tree and viewer, a terminal, a commit walkthrough, project notes, and a browser preview |
| **Model picker** | Reads `cmdc --list-models`, groups by provider, and passes the chosen model to the turn |
| **Context card** | Token usage, cache hit rate, cost, turns, and an estimated context window for the active session |
| **Permission modes** | Read-only by default, Accept edits, Plan, and Full access (`--yolo`) |
| **Updates** | Checks the GitHub repo, refuses to pull over uncommitted work, and fast-forwards when the tree is clean |
| **Password gate** | One password, per-device trusted cookies, rate-limited attempts, strict CSP |
| **Zero dependencies** | Plain Node 22+ and static files. Nothing to `npm install` |

## Requirements

- **Node.js 22 or newer** (`node --version`)
- **Command Code CLI**, installed and signed in:
  ```
  npm i -g command-code@latest
  cmd login
  cmd status
  ```
- **Tailscale**, running on this machine and on the phone you will use

## Platform support

| | Windows 10/11 | macOS | Linux |
| --- | --- | --- | --- |
| Server (`server.mjs`) | Yes — tested | Yes — expected | Yes — expected |
| Portable launcher (`bin/thechambers.mjs`) | Yes — tested | Yes — expected | Yes — expected |
| `start-thechambers.sh` | — | Yes | Yes |
| `start-thechambers.ps1` / `.bat` / `.lnk` | Yes | — | — |
| Tailscale discovery | `tailscale` on PATH, else Program Files | PATH, else `/Applications/Tailscale.app/…/Tailscale` | `tailscale` on PATH |
| CLI discovery | `npm root -g`, `%APPDATA%\npm`, nvm, Volta | `npm root -g`, `/opt/homebrew/lib`, `/usr/local/lib`, nvm | `npm root -g`, `/usr/local/lib`, `/usr/lib`, `~/.npm-global`, nvm |
| Config directory | `%USERPROFILE%\.config\thechambers` | `~/.config/thechambers` | `~/.config/thechambers` |

Only Windows has been exercised end to end on this machine; macOS and Linux follow the same
`bin/thechambers.mjs` path with per-platform binary lookup, so they should behave identically. If
anything differs, `THECHAMBERS_HOST` and `CMDC_ENTRY` override discovery outright.

## Install

```bash
git clone https://github.com/shawnradam/TheChambers.git
cd TheChambers
```

There is no build step and no `npm install` — the app is plain Node 22 plus static files. If you
prefer, `npm start -- --local` works too, because `package.json` points at the same launcher.

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
./start-thechambers.sh                      # Tailscale address, port 3002
./start-thechambers.sh --local              # loopback only
./start-thechambers.sh --port 3003 --workspace ~/code
```

or call the launcher directly, which is identical on every platform:

```bash
node bin/thechambers.mjs --help
node bin/thechambers.mjs
```

If the script is not executable after a clone, run `chmod +x start-thechambers.sh`.

### Any platform, by hand

```bash
THECHAMBERS_HOST=127.0.0.1 node server.mjs     # Unix
$env:THECHAMBERS_HOST='127.0.0.1'; node server.mjs   # PowerShell
```

The server prints the address it bound to. The launcher is only convenience around this.

## The command

`bin/thechambers.mjs` is a small Unix-shaped CLI, identical on all three platforms. Either run it
with `node bin/thechambers.mjs …`, or make it global once and use it directly:

```bash
npm link            # or: npm i -g .
thechambers help
```

```
thechambers [start] [--port 3002] [--host <addr>] [--workspace <dir>] [--local]
thechambers status
thechambers stop
thechambers doctor
thechambers version
```

| Command | What it does |
| --- | --- |
| `thechambers` | starts the server (same as `start`), prints the banner, addresses and password path |
| `status` | asks `/health`: version, commit, workspace, turns in flight, phone and desktop URLs |
| `stop` | finds the process listening on the port (`netstat` on Windows, `lsof` elsewhere) and stops it |
| `doctor` | checks Node ≥ 22, the Command Code CLI, Tailscale, the password file, the secret, and the port |
| `version` | prints the version and short commit |

Exit codes are ordinary: `0` ok, `1` problem, `2` bad usage, so it composes in scripts.

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

To rotate it, replace the file's contents and restart the server. Every device is signed out,
because the session cookie is derived from the password as well as the server secret. Deleting
`secret.txt` (it is regenerated) revokes every device without changing the password.

## Using it

The interface follows prior art's layout: a 280px sidebar, a 48px topbar, a centered hero on an
empty session, one composer that follows you into the conversation, and a 44px rail of workspace
panels on the right. On a phone the sidebar becomes a drawer and the rail moves into a panel menu.

### Sidebar

- **Chats** — conversations this app tracks, most recent first. Hovering a row reveals Archive and
  a menu with Rename, Export, and Delete. A green dot means a turn is running.
- **In work** — appears only while something is running.
- **Projects** — every working directory Command Code has sessions for. Click to expand: each
  nested row is a real session file, newest first; tap to resume it. **+** adds a folder by path.
- **Footer** — Settings, Updates (with a dot when GitHub has a newer commit), and export.

The magnifier filters chats, projects, and sessions; the panel icon collapses the sidebar.

### Topbar and session panel

The title follows the active session. The ring on the right shows the estimated share of the
context window used; the sliders button opens the **Session** card with context, cache-hit rate,
usage, message count, and turns. On phones the same button opens the panel menu.

### Workspace panels

The rail on the right opens one panel at a time:

| Panel | Contents |
| --- | --- |
| **Context** | Context use, message and turn counts, cost, token totals, last-turn metrics, a source-share bar, and the raw message list |
| **Git** | Branch, changed files, and an Initialize Git button for folders that are not repositories |
| **Changes** | The changed-file list with a colored unified diff for the selected file |
| **Walkthrough** | The last 30 commits (`hash`, date, subject) |
| **Files** | The project tree (dotfiles hidden), search, and a read-only file viewer |
| **Terminal** | Runs PowerShell (or `/bin/sh`) commands in the project folder, 120-second timeout, output capped |
| **Browser** | Preview a local dev server in an iframe |
| **Project knowledge** | Notes, Todo, and Plans per workspace, stored server-side |

Terminal and Full access are real: anything they can do, they do on this machine. There is no
extra confirmation in the web UI.

### Composer

- Placeholder: *Plan, build, or ask.* Enter sends on a physical keyboard; on touch devices the
  arrow button does.
- **+** attaches file names as `@mentions`, the shield picks the permission level, the target
  starts a goal, the model chip lists `cmdc --list-models` by provider, and **Build / Plan**
  switches the agent.
- In an empty session, the suggestion chips seed a prompt.
- **Stop** kills the whole process tree. Everything that had already committed stays on disk.

### Picker

The composer has the same three triggers as prior art:

- **`/`** opens the command menu. `↑`/`↓` moves, `Enter` or `Tab` selects, `Esc` closes. Commands
  sourced **APP** run in the app (`/new`, `/model`, `/mode`, `/plan`, `/rename`, `/export`,
  `/context`, `/stop`, `/settings`, `/help`). **STARTER** commands seed a ready prompt
  (`/explore`, `/catch-up`, `/debug`, `/plan-feature`, `/craft-goal`, `/review`). **CMDC**
  commands insert the command text for the agent.
- **`@`** searches the workspace and inserts a file or folder path.
- **`$`** lists installed skills from `~/.commandcode/skills` and `~/.agents/skills`.

### Permission modes

- **Read-only** (default) — reads, searches, explains. Headless Command Code denies file writes
  and shell commands, so nothing on the machine changes.
- **Accept edits** — passes `--accept-edits`: file edits apply without a prompt.
- **Plan** — passes `--plan`: read-only planning.
- **Full access** — passes `--yolo`: edits files and runs commands with no approval prompt.

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
| `notes.json` | Project knowledge: notes, todos, and plans per workspace |
| `settings.json` | Update preferences and the last known remote commit |

Back up the first two if you want to keep passwords and logins; the rest is disposable.

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
| `PATCH` | `/api/conversations/:id` | `{title}` → rename |
| `DELETE` | `/api/conversations/:id` | Forget a chat (the session file is left alone) |
| `POST` | `/api/turn` | `{conversationId?, workspace?, text, mode, model?}` → SSE stream |
| `POST` | `/api/stop` | `{conversationId}` → kill the running turn |
| `GET` | `/api/files?workspace=&path=` | One directory in the project tree |
| `GET` | `/api/file?workspace=&path=` | Read-only file contents (512 KB cap) |
| `GET` | `/api/search?workspace=&q=` | Recursive file-name search (200 results) |
| `GET` | `/api/git?workspace=` | Repository state and `git status` |
| `POST` | `/api/git/init` | `{workspace}` → `git init` |
| `GET` | `/api/diff?workspace=&path=` | Unified diff, or a whole untracked file as additions |
| `GET` | `/api/walkthrough?workspace=` | The last 30 commits |
| `POST` | `/api/exec` | `{workspace, command}` → run a shell command (120 s, output capped) |
| `GET`/`POST` | `/api/notes?workspace=` | List or add notes, todos, and plans |
| `PATCH`/`DELETE` | `/api/notes/:id` | Edit or remove one note |
| `GET` | `/api/models` | Parsed `cmdc --list-models`, grouped by provider |
| `GET` | `/api/skills` | Installed skills, read from `~/.commandcode/skills` and `~/.agents/skills` |
| `GET`/`POST` | `/api/settings` | Update preferences |
| `GET` | `/api/update?force=1` | Compare local HEAD with GitHub (checks whether the local tip is ahead) |
| `POST` | `/api/update/apply` | Fast-forward pull; refuses when the tree is dirty |

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

The workspace surfaces are deliberately powerful: the terminal runs commands, Full access edits
files, and the update endpoint pulls from GitHub. The password is the boundary. Run this only on a
tailnet you trust, and rotate the password if a device is lost.

## Project layout

```
server.mjs               HTTP server: auth, session catalog, transcripts, SSE, static files
public/index.html        Chat page
public/app.js            Streaming client, live polling, markdown, tool chips
public/styles.css        Dark, phone-first styles
public/logo-*.png        Logo (32/64/192/512) with the white background knocked out
public/apple-touch-icon.png
public/site.webmanifest  PWA manifest for Add to Home Screen
public/login.html        Password gate
public/login.js          Login form
start-thechambers.ps1    Windows launcher (Tailscale address, port check, password bootstrap)
start-thechambers.sh     macOS/Linux launcher, same options
start-thechambers.bat    Double-click wrapper
bin/thechambers.mjs      Portable launcher used by every platform
package.json             npm start / npm run verify
create-shortcut.ps1      Creates TheChambers.lnk
tools/verify.mjs         End-to-end check
tools/provider-check.mjs Adapter check: availability plus a throwaway turn
providers/               Agent adapters, one file each, with the contract in providers/README.md
docs/README.md           Documentation policy: one md per creation, changelogs required
docs/CHANGELOG.md        Chronological, commit-linked history
```

Every area documents itself next to its code: `server.md` for the backend, `bin/README.md` for the
CLI, `public/README.md` for the interface, `tools/README.md` for the checks, and
`providers/README.md` for the adapter contract. If a change touches an area without updating its
document, the change is incomplete.

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
- Tailscale is assumed; there is no TLS of its own, which is why the server refuses to bind a
  public interface by default.
- The terminal panel and Full access can run arbitrary commands. The password is the boundary.

## Contributing

Issues and pull requests are welcome — it is one person's project, so the useful shape is: open an
issue describing the behaviour, then a small focused PR. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the layout of the code, how to run it against a scratch port, and the two rules that keep the
design honest (no new dependencies; the transcript is the only source of history).

## License

TheChambers is free software under the **GNU General Public License v3.0 or later** — see
[LICENSE](./LICENSE). You can use it, study it, change it and share it; if you distribute a modified
version, it stays under the same licence. Copyright © 2026 Shawn Radam.

This project is not affiliated with Command Code or prior art. Command Code is a separate product
with its own terms; this project only drives the CLI you already installed and signed in. The
interface design is inspired by prior art, and credit for it belongs there.
