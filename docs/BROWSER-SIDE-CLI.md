# Browser-side CLI

**Browser-side CLI** — *noun.* A command-line coding agent that you drive from an ordinary browser
tab, where the agent CLI runs on a machine you control and the browser is only the client. The
inverse of a **browser CLI**.

Coined here on **2026-11-20** to name the direction TheChambers started.

## Two directions, one phrase

| Term | Means | In the wild |
| --- | --- | --- |
| **browser CLI** | a CLI that *drives a browser* — automation, rendering, DevTools capture | `six-ddc/browser-cli`, "Agent-Browser CLI", `huangmingche/browsercli`, `jayadevx/browsercli` |
| **browser-side CLI** | a CLI that *you drive from a browser*; the browser is the client | TheChambers |

Checked on 2026-11-20: GitHub alone returns 27 repositories matching `browsercli`, and every
meaningful one means the first row. The unqualified phrase is spoken for. The phrase with *a side* is
not — and that is the direction this project actually goes.

Keep the two apart in writing, in repo names, and in conversation. "Browser CLI" invites the wrong
reader: someone searching for it wants browser automation, not a remote for their coding agent.

## The five tests

A project is a browser-side CLI when all five hold:

1. **The client is a browser you already have.** Nothing to install on the phone, no app store, no
   extension.
2. **You control both ends.** The server runs on your hardware and the agent CLI runs on that same
   machine. No vendor cloud sits in the middle holding the session.
3. **The session is the CLI's own.** The conversation lives in the agent's own transcripts on disk
   and resumes in a real terminal — not in a chat log the web app invented.
4. **Reachability is private.** A tailnet, a VPN, or an SSH tunnel. Not a public URL handed out by a
   hosted service.
5. **The CLI is pluggable.** The agent is an adapter with a documented contract, not one hardcoded
   vendor.

## TheChambers against the tests

| Test | Status |
| --- | --- |
| Browser as the only client | Meets it — static files and SSE, phone-friendly at 412px |
| Both ends yours | Meets it — binds the Tailscale address and loopback only |
| The CLI's own session | Meets it — sessions read from `~/.commandcode/projects/`, resumed with `--resume` |
| Private reachability | Meets it — tailnet only, no tunnel, no public URL |
| Pluggable CLI | **Partial** — `cmdc` ships as the reference adapter, the contract is documented in `providers/README.md`, and extra adapters drop into `~/.config/thechambers/providers/`, but only one adapter exists today |

The fifth test is the one to finish before this claim is comfortable. See `providers/README.md`.

## What this is not

- **Not a trademark.** Nobody owns a generic two-word phrase in software, and this document does not
  claim one. It is a definition with a date, so the term means something precise when this project
  uses it.
- **Not an exclusive club.** If someone else builds a CLI you drive from a browser over their own
  network, they are a browser-side CLI too — and this document is how the phrase is used.
- **Not a claim to be first to the idea.** If you know of an earlier project that passes all five
  tests, say so in an issue and this document will credit it. The claim is: this is the first we know
  of, dated here.

## Related

- `providers/README.md` — the adapter contract that makes the fifth test possible
- `../README.md` — what TheChambers is, and the unofficial-project notice

## Changelog

- **2026-11-20** — Document created. Term and its five tests defined, contrasted with the established
  "browser CLI", TheChambers' status against each test stated honestly, and the partial fifth test
  named as the outstanding work.
