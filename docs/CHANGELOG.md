# Changelog

Newest first. Each entry names the area, what changed, why, and how it was verified. Area docs carry
their own smaller changelogs; this file is the whole story in order.

## 2026-11-21

### workrooms
- Added Admin-managed worker accounts with generated passwords, private task rooms, and role-based usage allowances.
- Added plan and design handoffs, Debugger review, Admin approval, and Programmer-only GitHub push of the approved commit.

### interface
- Added a dimensional logo treatment to the login screen, About pane, and Credits.

### server and launcher
- Fixed handling for malformed URLs, login bodies, and unrelated cookies.
- Checked the listener against the server PID record before stopping it.

### packaging
- Fixed: the npm package includes the provider and plugin modules required by the server and
  verification scripts.

## 2026-11-20

### interface — what Steer costs, and a steer that never went out
- Fixed: a steer issued after the turn had already ended set `steerPending` with no turn left to
  release it, so the message was never sent and nothing said so (`/api/stop` returned 404). With no
  turn in flight, a steer now sends directly
- Added: when a turn is stopped, its streamed answer is kept on screen in a dashed block headed
  "Stopped before it finished — this answer is not in the session", anchored before the message the
  steer went on to send, else after its own prompt, else last. It is deliberately not persisted: the
  transcript stays the only history
- Why: killing the agent means the interrupted turn never reaches cmdc's transcript, so the refresh
  that follows a stop was deleting it from view — the reported "the other task gone"
- Verified: steering mid-stream returns `/api/stop` 200 and keeps 516–697 characters across the
  refresh, correctly ordered; the not-running path posts the message immediately; `tools/verify.mjs`
  15/15

### server + interface — Hold and Steer, and one turn per session
- Fixed: a second concurrent turn in the same conversation was accepted and overwrote the `running`
  record, so a second agent process wrote the same transcript and the earlier child could no longer be
  stopped by `/api/stop`. `/api/turn` now answers 409 while a turn runs
- Changed: Docket and Gavel became **Hold** and **Steer**, one joined segmented control. Steer appears
  as soon as there is text while a turn runs, matching the Codex arrangement: hold by default, steer
  deliberately (Ctrl+Enter)
- Added: a held-message strip above the composer; each row carries its own Steer and an ×
- Fixed: steering polled for up to 8s and could race the held drain into a second POST. Steering is now
  a promise — hold the text, stop the turn, send when that turn's stream closes; steer first, then held
  messages, in order
- Fixed: `fileHold` never refreshed the badge or the strip, so held messages were invisible
- Verified: double dispatch posts one turn and holds the second; steer + two held messages produce
  `[turn 1, steer, held-1, held-2]` with four 200s; busy transitions alternate true/false four times
  (no overlap); the composer returns to idle with the strip hidden; `tools/verify.mjs` 15/15

### interface — the term this project coined
- Added: `docs/BROWSER-SIDE-CLI.md` defines **browser-side CLI** — a CLI you drive from a browser,
  the inverse of the established "browser CLI" (a CLI that drives a browser). Five tests, TheChambers'
  status against each one, and the partial fifth test (only one adapter) named as outstanding work
- Added: README section, page meta description and keywords, manifest description, help-modal line
- Why: GitHub alone returns 27 repositories named `browsercli`, all meaning the opposite direction, so
  the unqualified phrase is taken; the term with a side is the one worth owning
- Verified: README renders the section, `docs/BROWSER-SIDE-CLI.md` links resolve, no code paths touched

### interface — composer polish: icons, budget, no slivers
- Changed: Docket and Gavel are amber pills with their own icons (filed document, mallet) and the
  docket carries a count badge rather than putting the number in the label
- Fixed: the phone bar overflowed, so flex shrank the model chip to 6px and the stop button to 9px.
  Under 520px the pills now drop their words, the model chip shows only the model name, the agent dot
  is dropped, and the stop button is pinned at a real tap size with a filled look
- Fixed: the docket was disabled on an empty composer and therefore usually grey; it opens the filed
  list, so it is never disabled — only the gavel needs text
- Verified: badge reads 1 then 2, the filed list shows both items plus Clear, dropping the first
  returns it to 1, pills 34px, model chip 47.5px, stop 34px, no console errors

### interface — header indicator, Docket and Gavel
- Added: THECHAMBERS wordmark above the sidebar header with the chat's braille spinner beside it
  (same 80ms frames, smaller and dimmer), visible only while a turn runs
- Added: Docket and Gavel during a turn. Docket files the text and sends it when the turn ends, shows
  the count in its label, and opens the filed list on an empty composer where items can be dropped or
  cleared. Gavel stops the turn and sends immediately in the same session. Enter mid-turn files;
  Ctrl+Enter is the gavel; `/docket` and `/gavel` mirror both from the picker
- Changed: first labelled "Queue / Steer" — borrowed, generic words — then renamed to this project's
  own vocabulary
- Why: no way to queue a follow-up or redirect a running agent existed, and the header should signal
  work when the thread is out of view; checked code and full history and confirmed neither action had
  ever been implemented here
- Verified: idle hides both and leaves the header frame unanimated; filing shows `Docket 1` then
  `Docket 2` and clears the input; the list drops to `Docket 1` after removing an item; the picker
  lists `/docket` and `/gavel`; no console errors

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
