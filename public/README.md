# public — the interface

Four static files, no framework, no build step. `index.html` holds the markup and an SVG sprite;
`app.js` is the client; `styles.css` is the visual system; `login.html`/`login.js` are the gate.

## Layout

- **Sidebar**: `New session`, project menu, search, Chats / In work / Projects, footer icons
  (settings, updates, export).
- **Topbar**: title, context ring (tokens used vs the model window), session panel toggle.
- **Workspace**: the empty state (hero + chooser + suggestion chips) or the thread.
- **Right rail**: context, git, changes, walkthrough, files, terminal, browser, knowledge, config.
- **Composer**: attachment, permissions, goal, concise, model chip, agent chip, stop, send.

## Behaviour worth knowing

- **Streaming** is one SSE response per turn; text deltas render through a small markdown renderer.
- **Live polling** re-reads the conversation every 2.5s while a chat is open, so turns finished in a
  terminal appear here; the **live** pill appears when another writer touches the session.
- **Working mark**: the braille spinner Command Code's own terminal uses (80ms frames) plus a short
  sentence that rotates every 2.8s. There is deliberately no box around it.
- **Modes** come from the active provider. Read-only is the default; Full access passes the
  provider's flags.
- **Concise** (the ≡ button) is per conversation, off by default; it prefixes the message with a
  visible `[concise mode]` preamble.
- **Images** are downscaled to 1024px / JPEG 0.8 before upload, with the saving shown.
- **No programmatic focus on touch devices**: opening a view must never raise the soft keyboard.
- **Help**: "How this works" opens on first visit per device, and any time from ⋯ or `/help`.
- **Credits**: ⋯ → "Version x.y.z" opens a credits popup; it does not navigate away.
- **Picker**: `/` opens the command menu, `@` mentions files, `$` lists skills.

## Changelog

### 2026-11-20 — type scale and the menu icon
- Changed: menu button is a bullet-list icon — three rows of a filled dot plus a horizontal bar,
  left-aligned, 20px box — instead of the horizontal hamburger
- Changed: baseline type and controls grew about 1px — sidebar items 15px, section labels 14px,
  title 16px, menu rows 34px tall, icon buttons 30px, composer 15px, chips 13.5px
- Why: the app is read on a phone at arm's length; the old sizes were tuned for a desktop window,
  and the reference for the menu glyph is a bulleted list, not three bars
- Verified: 8× zoom shows three dot+bar rows, evenly spaced and centred; drawer and empty state
  checked at 412px

### 2026-11-14 — 69319bd
- Changed: the version line in the ⋯ menu opens a Credits popup instead of GitHub
- Why: keep people in the app; authorship and licence in one card

### 2026-11-14 — 9438c29
- Added: "How this works" — resuming, the terminal bridge, modes, tokens, agents, troubleshooting;
  auto-opens once per device, also from ⋯ and `/help`
- Why: not everyone knows `/resume` is a picker or why the terminal needs it

### 2026-11-14 — 2e0a34c
- Added: concise toggle, image downscale before upload, usage numbers in the session card
- Why: make the token levers visible and measurable

### 2026-11-14 — c062ed3 / a8d2877
- Changed: the working mark uses Command Code's braille frames, then lost its chip
- Why: match the CLI's motion; the box read as clutter

### 2026-11-13 — 972d407
- Added: the rail panels, session panel, settings dialog, search, toasts, modals
- Why: parity with the prior art layout this interface follows
