# Documentation policy

This file is the rule, not a suggestion. It exists because the project grows faster than memory.

## The rule

1. **One `.md` per creation, in the creator's folder.** A module, command, panel, endpoint, adapter
   or tool gets a markdown file next to it — `providers/README.md`, `bin/README.md`,
   `tools/README.md`, `public/README.md`, `server.md` at the root.
2. **Edit the code → edit the doc in the same change.** A behaviour change without its doc update
   is an incomplete change.
3. **New flows ship documented.** A new command, setting, endpoint, adapter or screen includes its
   section, screenshots-free description, and a changelog entry. No doc, no merge.
4. **Every doc has a Changelog section**, newest first, each entry with `YYYY-MM-DD` and the short
   commit. The aggregate history is `docs/CHANGELOG.md`.
5. **Complete means documented.** When a feature is finished, its doc is finished and the root
   `README.md` describes it in "what this is / how to use it" terms.

## Where the docs live

| Doc | Covers |
| --- | --- |
| `README.md` | the product: what it is, install, use, platform support, licence, disclaimers |
| `server.md` | `server.mjs`: auth, turns, SSE, sessions, uploads, updates, usage, provider delegation |
| `providers/README.md` | the adapter contract, normalized events, worked example, checklist |
| `bin/README.md` | the `thechambers` CLI: every command, flag, exit code |
| `public/README.md` | the interface: layout, panels, composer, modes, concise, help, keyboard |
| `tools/README.md` | `verify.mjs` and `provider-check.mjs` |
| `docs/CHANGELOG.md` | chronological, commit-linked history |
| `CONTRIBUTING.md` | how to contribute, and the rules above |

## Changelog entry format

```
### 2026-11-14 — 69319bd
- Changed: the version line in the … menu opens a Credits popup instead of GitHub
- Why: keep people in the app; show authorship and licence in one place
- Verified: browser, popup renders version/author/licence, one link
```

## Applying it to old work

Documents are being written retroactively for what already exists. Until an area has its doc, treat
the root README as authoritative for that area and add the doc before changing the area again.

## Consolidation when the work is finished

Area docs are the working set while things are still moving. When the project is complete:

1. The area docs are **merged into one full document** — `docs/THE-CHAMBERS.md` — with sections in
   this order: what it is, install, use, agents, interface, server, CLI, checks, security, licence.
2. Each area's changelog entries are folded into that document's single changelog, in date order.
3. The area files stay in place next to their code as references; the merged document is the one a
   new reader opens first, and the root README links to it.
4. Nothing is deleted until the merged document has been read once and verified against the code.

**Status:** `docs/THE-CHAMBERS.md` exists and is the first thing a reader should open; the area docs
remain next to their code. Future changes update the area doc and the merged document together.

Until that point, do not merge early: a combined doc that is wrong in three places is worse than
five small docs that are each right.

