# Contributing to TheChambers

Thanks for looking. This is a personal project shared in case it is useful — small, focused
contributions are the easiest to review.

## Before you start

- **Not official.** TheChambers is not affiliated with Command Code or prior art. Please don't
  report its bugs to either project.
- **Open an issue first** for anything larger than a typo: describe what you expected, what
  happened, and the platform (`thechambers doctor` prints most of what is needed).
- **Licence:** contributions are accepted under the GNU GPL v3.0 or later, the same licence as the
  project. By opening a pull request you agree to that.

## The rules that keep it honest

1. **No runtime dependencies.** The app is plain Node 22 plus four static files. Anything that
   needs an `npm install` at runtime is a design change, not a patch — discuss it in an issue first.
2. **The transcript is the only history.** Conversations are not stored twice: the active provider
   reads the agent's own session files. A feature that keeps a parallel message store is almost
   certainly wrong.
3. **One file per agent.** Supporting a new coding-agent CLI means adding `providers/<id>.mjs`, not
   branching the server. The contract, the normalized events and a worked example are in
   [providers/README.md](./providers/README.md); `providers/cmdc.mjs` is the reference.
4. **Docs ship with the code.** Every creation gets a `.md` beside it, every change updates that
   `.md` in the same commit, and each doc carries a dated changelog. The rule and the file map are
   in [docs/README.md](./docs/README.md); the running history is [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## Getting set up

```bash
git clone https://github.com/shawnradam/TheChambers.git
cd TheChambers
node bin/thechambers.mjs doctor      # node, CLI, Tailscale, password, port
node bin/thechambers.mjs providers   # which agent adapters are available
node bin/thechambers.mjs --local     # run on 127.0.0.1:3002 without Tailscale
```

No build step, no install. `npm link` gives you the `thechambers` command globally.

## Where things live

| File | Responsibility |
| --- | --- |
| `server.mjs` | HTTP server: auth, SSE turns, uploads, updates, provider delegation |
| `providers/cmdc.mjs` | Command Code adapter: turns, frames, sessions, transcripts |
| `providers/index.mjs` | adapter registry, including `~/.config/thechambers/providers/` |
| `bin/thechambers.mjs` | CLI: `start`, `status`, `stop`, `doctor`, `providers`, `version` |
| `public/app.js` | client: streaming reader, live polling, markdown, panels, working indicator |
| `public/styles.css` | the whole visual system; palette at the top in `:root` |
| `public/index.html` | markup and the SVG icon sprite |
| `tools/verify.mjs` | end-to-end check; run it after touching auth or the turn path |
| `tools/provider-check.mjs` | adapter check: availability plus a throwaway turn |

## Testing a change

Run against a scratch port so you don't disturb a running instance:

```bash
THECHAMBERS_PORT=3010 THECHAMBERS_HOST=127.0.0.1 node server.mjs
node tools/verify.mjs http://127.0.0.1:3010
```

`verify.mjs` covers the login gate, session listing, resume, and a real streamed turn. It costs a
small amount of credit because the last check runs the agent.

For a browser check, `node bin/thechambers.mjs --local --port 3010` then open it. The phone layout
is the important one: 390–430px wide, no horizontal scroll, composer reachable with one thumb, and
opening a view must never pop the soft keyboard (programmatic `focus()` is inert on coarse
pointers — keep it that way).

## Style

- Match the surrounding code: two spaces, single quotes, semicolons, `const` by default.
- Comments explain *why*, not *what*. The unusual decisions (stdin prompt delivery, transcript
  caching, heartbeat placement) each have a paragraph saying why they are that way; if you change
  one, update its comment.
- No frameworks, no bundler. If a feature needs either, it probably belongs in a branch that
  discusses it first.

## Security

Changes to auth, bind address, uploads or the update path get a slower, closer read. Keep the
invariants: cookie derived from the password, same-origin check on every write, no secret in the
repository, TLS left to Tailscale, and a loud warning when binding anywhere else.

## Commits and PRs

- One topic per commit; say what changed and why in the body.
- Include what you tested and on which platform.
- Screenshots help for UI work — before/after at phone width is ideal.
