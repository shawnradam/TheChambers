# Changelog

Newest first. Each entry names the area, what changed, why, and how it was verified. Area docs carry
their own smaller changelogs; this file is the whole story in order.

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
- Changed: README opens with the unofficial/prior art/Telegram notice
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
- Logo in login, header, favicon, manifest; prior art-parity shell; collapsed-sidebar fix
- Why: a phone front end that looks and behaves like the tool it mirrors
