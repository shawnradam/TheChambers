# Changelog

Newest first. Each entry names the area, what changed, why, and how it was verified. Area docs carry
their own smaller changelogs; this file is the whole story in order.

## 2026-11-20

### interface — header indicator, Queue and Steer
- Added: THECHAMBERS wordmark above the sidebar header with the chat's braille spinner beside it
  (same 80ms frames, smaller and dimmer), visible only while a turn runs
- Added: Queue and Steer during a turn; Queue holds the text until the turn ends, Enter mid-turn
  queues, Steer stops the turn and sends immediately in the same session
- Why: no way to queue a follow-up or redirect a running agent existed, and the header should signal
  work when the thread is out of view; checked code and full history and confirmed neither action had
  ever been implemented here
- Verified: the working class toggles `brand-frame-breathe`, the header frame is invisible and
  unanimated when idle, buttons appear only while busy, queue records and clears the input, buttons
  hide when the turn ends

### interface — type scale and menu icon
- Changed: the menu button is a bullet-list icon (three rows of dot + horizontal bar, left-aligned,
  20px) instead of the horizontal hamburger or vertical strokes
- Changed: baseline type and controls grew ~1px — sidebar items 15px, labels 14px, title 16px,
  menu rows 34px, icon buttons 30px, composer 15px, chips 13.5px
- Why: the interface is used at arm's length on a phone, and the requested reference is a bulleted
  list, not three bars
- Verified: 8× zoom shows three dot+bar rows evenly spaced and centred; 412px drawer and empty state
  reviewed

## 2026-11-17

### consolidation — docs
- Added: `docs/THE-CHAMBERS.md`, one local document covering install, use, agents, plugins, server,
  CLI, checks, security and licence
- Changed: that document is **not published** — it is git-ignored and kept on the author's machine;
  the repository carries the area docs only
- Why: the per-area docs are for working; the merged one is private reference material

### plugins — extension system
- Added: `plugins/` (registry, `_template`, manager, trust dialog), `tools/plugin-check.mjs`, rail
  panel and `/` commands; routes at `/api/plugin/<id>/…`
- Why: FTP and similar features should not grow the core
- Trust: a plugin runs Node in the server process; enabling is explicit
- Landed from a parallel session and committed with the docs; not verified by the docs author beyond
  loading `plugin-check`

## 2026-11-14

### 69319bd — interface
- Changed: ⋯ → "Version 1.2.0" opens a Credits popup instead of GitHub
- Why: keep people in the app; one card for authorship, licence, credit and the unofficial notice
- Verified: browser, popup renders version/author/licence, one link, no console errors

### 9438c29 — docs in the app
- Added: "How this works", shown once per device, from ⋯ and `/help`; `/keys` and `/concise` in the picker
- Why: `/resume` being a picker and the terminal needing it are not obvious
- Verified: fresh browser profile opens it, flag set, `/help` reopens

### 2e0a34c — tokens
- Added: per-conversation concise mode, `/api/usage`, image downscale to 1024px
- Why: make token saving real and measurable; honest expectation 10–20%
- Verified: concise preamble stored in the transcript; usage `input 19373 / output 3 / cacheRead 5504`; 75,885 → 14,953 bytes on a 2000×1500 JPEG

### 9b647a1 — providers
- Added: `providers/` contract, registry and drop-ins, `providers` CLI command, `/api/providers`
- Changed: `server.mjs` delegates turns, sessions, transcripts to the active adapter; ~8 KB of cmdc code removed
- Why: support any CLI agent without forking
- Verified: verify.mjs 15/15, `provider-check cmdc` PASS

### 05a2870 — server
- Fixed: malformed JSON body returns 400 and stays out of `server.log`

### 00:00–10:00 — editing in flight
- The composer picker (`/`, `@`, `$`), authorship constants and README sections arrived from a
  parallel session; they share the same files and were committed alongside the work above.

## 2026-11-13

### 2fe1bc4 / c062ed3 / a8d2877 / 9e7161e — working mark
- Iterated from a shimmering C to Command Code's own braille spinner, sentences instead of single
  words, then no chip at all
- Why: the box and the twinkle read as clutter; the CLI's motion is the reference

### ee4e8b2 — CLI, licence, disclaimer
- Added: `thechambers status|stop|doctor|version`, GPL-3.0-or-later `LICENSE`, `CONTRIBUTING.md`
- Changed: README opens with the unofficial/Telegram notice
- Verified on Windows: doctor all-ok, stop kills a scratch instance

### 90ff1fd — sessions
- Changed: cookie derived from secret **and** password; rotating the password signs devices out
- Verified: login 200, logout 200, stale cookie 401

### 3e61628 — security
- Added: same-origin check on every write; warning when bound off-tailnet
- Verified: same-origin settings 200, cross-origin settings/upload 403

### d25eb16 — cross-platform
- Added: `bin/thechambers.mjs`, `start-thechambers.sh`, `package.json`; CLI/Tailscale discovery per OS
- Verified on Windows: loopback, tailnet, wrapper, `sh -n`

### 1be6b25 — hygiene
- Added: ignore rules for prompts, notes, `.commandcode/`, `AGENTS.md`
- Why: the public repository is the player, not the workshop

### 7677701 / f775f71 / 972d407 — brand and interface
- Logo in login, header, favicon, manifest; three-column shell with a workspace rail; collapsed-sidebar fix
- Why: a phone front end that looks and behaves like the tool it mirrors
