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
- **Header indicator**: the same braille frames the chat bubble uses run beside the THECHAMBERS
  wordmark while a turn is running — smaller, quieter, and driven by the same 80ms ticker — so the
  header shows this machine is busy even when the thread is scrolled away. It rests invisible when
  idle.
- **Docket / Gavel**: while a turn runs, the composer shows both, as amber pills — an icon, the word,
  and for the docket a count badge. *Docket* files your text and hears it as soon as the turn ends;
  pressing it with an empty composer opens the filed list, where each item can be dropped or the whole
  docket cleared. *Gavel* stops the turn and sends your text instead, in the same session. Enter
  mid-turn files to the docket; **Ctrl+Enter** is the gavel. `/docket` and `/gavel` do the same from
  the picker. Both names are the project's own — a docket is the list of matters to be heard, a gavel
  interrupts the proceeding.
- **On a phone** the bar is tight, so the two action pills show their icon and badge only, the model
  chip reads just the model name, and the agent dot is dropped (the label already says Plan or Build).
  Nothing is allowed to shrink to a sliver.

## Changelog

### 2026-11-20 — composer polish: icons, budget, no slivers
- Changed: Docket and Gavel are proper amber pills with their own icons — a filed document and a
  mallet — and the docket carries a count badge instead of the number in its label
- Fixed: on a phone the bar overflowed, and flex shrank the model chip to 6px and the stop button to
  9px. The pills now drop their words under 520px, the model chip reads just the model name, the
  agent dot is dropped (the label says Plan or Build), and the stop button is pinned at a real tap
  size with a filled rounded look. Measured after: every child between 28 and 48px, 62px free
- Fixed: the docket was disabled whenever the composer was empty, so it usually rendered greyed out —
  it opens the filed list, so it is never disabled now; only the gavel needs text
- Verified: filing shows the badge 1 then 2, the filed list lists both items with a Clear row,
  dropping the first returns the badge to 1, both pills measure 34px, the model chip 47.5px, the stop
  34px, and there are no console errors

### 2026-11-20 — header indicator, Docket and Gavel
- Added: THECHAMBERS wordmark above the sidebar header with the chat's braille spinner beside it —
  same 80ms frames, smaller and dimmer — visible only while a turn runs (static under reduced motion)
- Added: **Docket** and **Gavel** in the composer, visible only during a turn. Docket files the text
  and sends it when the current turn ends; the button shows the count and opens the filed list on an
  empty composer, where items can be dropped or cleared. Gavel stops the turn and sends the text
  immediately in the same session. Enter mid-turn files; Ctrl+Enter is the gavel; `/docket` and
  `/gavel` do the same from the picker
- Changed: these were first labelled "Queue / Steer" — borrowed, generic words. Renamed to this
  project's own vocabulary, with the docket list and count added
- Why: there was no way to line up a follow-up or redirect a running agent; both actions existed in
  the tool this layout was modelled on but never in this codebase — confirmed against the code and
  the full history. The header now signals work when the thread is out of view
- Verified: idle hides both and leaves the header frame at opacity 0 and unanimated; filing shows
  `Docket 1` then `Docket 2` and clears the input; the list renders each filed item and removing one
  drops the count to `Docket 1`; `/docket` and `/gavel` appear in the picker; no console errors

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
- Why: a three-column shell with a rail of workspace panels
