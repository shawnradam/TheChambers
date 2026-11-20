# tools — checks you can run

Both scripts are plain Node, no dependencies, and are meant to be run after touching auth, the turn
path, or an adapter.

## `verify.mjs` — end to end, through HTTP

```bash
node tools/verify.mjs http://127.0.0.1:3002
```

Checks, in order: the login gate refuses a wrong password, authorship constants are intact, the
right password unlocks, `/api/state` is closed to strangers and open with a cookie, projects include
the launch workspace, sessions are read from disk, resuming opens a conversation with its transcript,
a real turn streams text and finishes, and a session id is captured.

The last check runs the agent, so it costs a small amount of credit. Use a scratch port
(`THECHAMBERS_PORT=3010 node server.mjs`) so a live instance is untouched.

## `provider-check.mjs` — one adapter, no server

```bash
node tools/provider-check.mjs            # every adapter and its availability
node tools/provider-check.mjs cmdc       # availability, then a real throwaway turn
```

Starts the adapter directly, writes a one-line prompt to stdin, prints the normalized event counts
and the session id, and fails if the adapter throws in `parse()` or produces no text. This is the
fastest way to tell whether a new adapter is wired correctly.

## Conventions for new checks

- No dependencies, no network beyond the instance under test.
- Print `PASS`/`FAIL` per check and exit non-zero on failure, so CI can read it.
- Never assert on exact model output beyond a keyword the prompt forces.

## Changelog

### 2026-11-14 — 9b647a1
- Added: `provider-check.mjs`
- Why: new adapters need a way to prove themselves without the app running

### 2026-11-13 — fb789c5 onward
- Added: `verify.mjs`
- Why: the login gate and the streamed turn are the two places a regression is invisible
