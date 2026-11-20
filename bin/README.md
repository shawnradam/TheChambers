# bin — the `thechambers` command

One file, `bin/thechambers.mjs`, identical on Windows, macOS and Linux. Run it with
`node bin/thechambers.mjs …` or install it once with `npm link` / `npm i -g .`.

## Commands

| Command | Behaviour |
| --- | --- |
| `thechambers` / `start` | resolve Tailscale → probe port → validate workspace → exec `server.mjs` with stdio inherited |
| `status` | `GET /health`; prints version, commit, workspace, turns in flight, phone and desktop URLs |
| `stop` | checks the listener against the TheChambers PID record before terminating it |
| `doctor` | node ≥ 22, the agent CLI, Tailscale, password file, secret, port |
| `providers` | adapters with availability and the active one |
| `version` | version, short commit, author |
| `help` | usage; ends with the non-affiliation notice |

## Start options

```
--port <n>          default 3002
--host <addr>       bind this address instead of the Tailscale one
--workspace <dir>   folder new chats start in (default: home)
--provider <id>     use this agent adapter for the session
--local             loopback only, no phone access
```

Options may appear before the command (`thechambers --port 3003` is a start). Environment:
`THECHAMBERS_PORT`, `THECHAMBERS_HOST`, `THECHAMBERS_WORKSPACE`, `THECHAMBERS_PROVIDER`,
`CMDC_ENTRY`.

Exit codes: `0` ok, `1` problem (Tailscale down, port taken, checks failed), `2` bad usage — so it
composes in scripts.

## Notes

- The banner is ASCII on purpose; box-drawing characters mangle in redirection and old consoles.
- `stop` intentionally does not restart anything. The launcher is the only thing that starts a
  server, so "stop then start" is always two explicit steps.
- `providers` and `doctor` read the same registry the server uses, so they cannot drift.

## Changelog

### 2026-11-14 — 9b647a1
- Added: `providers` command, `--provider`, `THECHAMBERS_PROVIDER`
- Why: the CLI should be able to name the agent like the settings can

### 2026-11-14 — a8d2877 (earlier in the same day)
- Changed: `status` reads the host from `/health` instead of assuming the tailnet address
- Why: a loopback-only instance was advertising a phone URL nobody could reach

### 2026-11-13 — ee4e8b2
- Added: `status`, `stop`, `doctor`, `providers`; ASCII banner; exit codes 0/1/2
- Why: a launcher is not a command; people need to see where it is and how to stop it
- Verified on Windows: loopback, tailnet address, PowerShell wrapper, `sh -n` on the Unix script
