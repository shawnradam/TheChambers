// Copy this file to add an agent to TheChambers.
//
//   cp providers/_template.mjs ~/.config/thechambers/providers/my-agent.mjs
//   # edit it, then:
//   thechambers providers          # should list it with availability
//   node tools/provider-check.mjs my-agent
//
// Read providers/README.md first; it explains the contract and the rules.

import {spawn} from 'node:child_process';

export default {
  // Unique, lowercase, stable. Used in URLs and THECHAMBERS_PROVIDER.
  id: 'my-agent',
  label: 'My Agent',
  docs: 'https://example.com/my-agent/docs',
  capabilities: {
    resume: true, // can continue a previous session by id
    transcripts: true, // can list sessions on disk and replay one
    liveSessions: true, // a session being written elsewhere can be detected
  },

  // Every permission mode this agent supports. `flags` are appended to the argv.
  modes: [
    {id: 'read-only', label: 'Read-only'},
    {id: 'full', label: 'Full access', flags: ['--yolo']},
  ],

  // Is the CLI installed here? Called often; keep it cheap and never throw.
  available() {
    return {ok: false, detail: 'not implemented yet'};
  },

  // The executable used for auxiliary calls (model listing). Omit it if not supported.
  command() {
    return {file: 'my-agent', args: []};
  },

  // How one turn is launched. User text must NOT appear here — the server writes the prompt to
  // stdin so nothing typed on a phone can reach an argument list.
  turnArgs({sessionId, mode, model, effort, maxTurns}) {
    const args = ['run', '--json', '--max-turns', String(maxTurns || 60)];
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    const declared = this.modes.find((entry) => entry.id === mode);
    if (declared && declared.flags) args.push(...declared.flags);
    return args;
  },

  // Return a ChildProcess with pipeable stdin/stdout/stderr.
  spawn(args, cwd) {
    return spawn('my-agent', args, {cwd, stdio: ['pipe', 'pipe', 'pipe']});
  },

  // One raw stdout line (already JSON-parsed) → normalized events.
  // Supported types: text, tool, model, session, usage, final, error, done.
  parse(frame) {
    return [];
  },

  // Session catalog. Same shape the UI renders: id, title, cwd, model, createdAt, updatedAt,
  // active. `active` means "written in the last couple of minutes".
  sessions({workspace, limit = 200} = {}) {
    return [];
  },

  // The messages to display for a session: [{role:'user'|'assistant', text, tools, ts}].
  // Return the active branch, not every branch.
  transcript(sessionId) {
    return [];
  },

  // Optional: called after a turn so the next sessions() sees the new one.
  invalidate() {},
};
