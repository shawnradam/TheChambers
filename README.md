# TheChambers

Drives **Command Code** from a phone. This folder runs a small web app on this machine, binds it
to the machine's Tailscale address, and gives you a chat interface that streams the agent's work
live. Everything executes here — the phone is only a window into it.

It reads Command Code's own session transcripts (`~/.commandcode/projects/<slug>/<id>.jsonl`), so
it shows work you started in a terminal, and it continues the same session when you send from the
phone. One session, two views.

## Start it

Double-click **TheChambers.lnk**, or run:

```
powershell -ExecutionPolicy Bypass -File .\start-thechambers.ps1
```

Options:

```
.\start-thechambers.ps1 -Workspace "C:\path\to\project"   # where the agent works (default: your home folder)
.\start-thechambers.ps1 -Port 3003                        # if 3002 is taken
.\start-thechambers.ps1 -Local                            # loopback only, no phone access
```

Stop it with Ctrl+C (that window must stay open while you use it).

## How to reach it

| Device | Address |
| --- | --- |
| Phone, anywhere | `http://100.74.112.1:3002` |
| Phone, by name | `http://shawnradam.taile0072c.ts.net:3002` |
| This desktop | `http://127.0.0.1:3002` |

Both phone addresses need **Tailscale running on the phone**. The port is not open to the internet
and not open to the local network — the server binds the Tailscale address and loopback only.

The password is not in any script:

```
C:\Users\ADMIN\.config\thechambers\ui-password.txt
```

Generated on first run. Paste it once per device and keep **Trust this device** ticked.

## One session, two views

This is the part worth understanding, because Command Code has no attach API: a running terminal
holds its conversation in memory and writes the transcript to disk as each turn commits.

So the bridge works at the session file:

```
   terminal (cmdc)                      phone (TheChambers)
        │                                      │
        ├── writes turn ──► transcript ◄── polls every 2.5s
        │                                      │
        └── ◄── /resume reloads ────────────── sends a turn (--resume <same id>)
```

- **Phone → terminal:** a message sent here runs headless against the *same session id*, so the
  turn is appended to the transcript. The terminal does not see it until you run `/resume` (pick
  the same session) — it holds state in memory and has no way to be told otherwise.
- **Terminal → phone:** whenever you finish a turn in the terminal, this app picks it up on its
  next poll and renders it. The **live** pill appears while the session file is being written by
  something other than this app, and the note above the composer repeats the `/resume` reminder.
- **Do not type in both at once.** Two writers on one transcript create two branches of the same
  session rather than corrupting it, but the history then forks. Finish a turn in one place before
  using the other.

Sessions started here are ordinary Command Code sessions and stay visible to `cmd -r`, `/resume`,
`/tree` and `/export` in a terminal.

## Projects and sessions

The sidebar is the phone version of a folder picker:

- **Project dropdown** — every working directory Command Code already has sessions for, newest
  first, plus folders you add with **+**.
- **Chats** — conversations this app knows about; each remembers its own folder.
- **Sessions** — the real session files on disk for the selected project, newest first. Anything
  written in the last two minutes is marked `● live now`, which is how you find the terminal
  session you are currently in. Tap one to resume it; the transcript is read straight from disk.

## Permission modes

- **Read-only** (default) — Command Code can read, search, and explain, but headless mode denies
  every file write and shell command.
- **Full access** — passes `--yolo`, which lets it edit files and run commands without asking.
  There is no approval prompt in the web app, so use it deliberately.

That is not a limitation of this app: headless Command Code blocks mutating tools unless `--yolo`
is passed.

## How it works

Each message spawns one headless run and streams it back:

```
browser  ──POST /api/turn──►  server.mjs  ──spawn──►  node <cmdc entry> -p --output-format json
   ▲                              │                        │
   └───── SSE data frames ◄───────┘ ◄──── NDJSON frames ───┘
```

Three details worth knowing if this ever needs fixing:

**The prompt goes in on stdin, never on the command line.** Windows needs a shell to launch the
`cmdc` shim, so the server runs the bundled entry point with this same `node` binary and writes
the message to stdin. No user text can reach an argument list.

**History is not stored twice.** The app keeps only conversation metadata (id, session id, folder,
title) in `C:\Users\ADMIN\.config\thechambers\conversations.json`; every message comes from the
transcript, cached by file mtime + size so polling a large session is cheap.

**Streaming is SSE, not WebSocket.** A turn is one long-lived HTTP response, with a heartbeat every
15 seconds so phone networks do not drop an idle connection. If the phone leaves mid-run, the run
still finishes — the transcript is the record.

Auth: the cookie is an HMAC of the password, not the password. Ten wrong attempts lock that
address out for ten minutes. Pages are served with a strict CSP and no inline script.

## Checking it still works

```
node tools\verify.mjs http://127.0.0.1:3002
node tools\verify.mjs http://100.74.112.1:3002
```

Checks: wrong password refused, right password unlocks, state closed to strangers, projects
include the launch folder, sessions are read from disk, resuming opens a conversation with its
transcript, and a real turn streams text and finishes. The last check runs the actual agent, so it
costs a small amount of credit.

## Files here

| File | Purpose |
| --- | --- |
| `server.mjs` | Server: auth, session catalog, transcript reading, SSE streaming, static files. No dependencies |
| `public/index.html` | Chat page: sidebar, projects, sessions, composer |
| `public/app.js` | Streaming client, live polling, markdown, tool chips |
| `public/styles.css` | Dark phone-first styles |
| `public/login.html`, `public/login.js` | Password gate |
| `start-thechambers.ps1` | Launcher: resolves the Tailscale address, checks the port, starts the server |
| `start-thechambers.bat` | Wrapper that runs the launcher and keeps the window open |
| `create-shortcut.ps1` | Creates `TheChambers.lnk` here (run once) |
| `tools/verify.mjs` | End-to-end check |

## Troubleshooting

**"Port 3002 is already in use by …"** — something else owns it. `-Port 3003` and open the new
address.

**"Tailscale is not running, so the phone will not reach this."** — start Tailscale, or use
`-Local`.

**The page opens but the phone cannot reach the server** — the phone's Tailscale is off, or you are
using the MagicDNS name with MagicDNS disabled. Use the `100.x` address.

**A message from the phone is not in the terminal** — expected. Run `/resume` in the terminal and
pick that session. The session list in this app shows `● live now` for the session you are in.

**The live pill keeps appearing** — another process (a terminal, or a second browser tab) is
writing to this session. That is the fork warning; use one side at a time.

**A request from the phone silently does nothing to files** — Read-only mode. Switch to Full access
and resend.

**"Could not start Command Code"** — the start-up log prints the resolved CLI path. If it says
`cmdc (PATH)`, reinstall with `npm i -g command-code@latest`.

**Everything asks for the password again** — you unticked Trust this device, or the cookie expired
after 30 days.

**A turn hangs** — press Stop. That kills the process tree; the transcript keeps everything that
had already committed.
