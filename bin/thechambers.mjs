#!/usr/bin/env node
// TheChambers — Command Code from your phone, over Tailscale.
// Copyright (C) 2026 Shawn Radam. Licensed under the GNU GPL v3 or later; see LICENSE.
//
// A small, Unix-shaped command:
//
//   thechambers [start] [--port 3002] [--host <addr>] [--workspace <dir>] [--local]
//   thechambers status
//   thechambers stop
//   thechambers doctor
//   thechambers version
//   thechambers help

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SERVER = path.join(ROOT, 'server.mjs');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'thechambers');
const PASSWORD_FILE = path.join(CONFIG_DIR, 'ui-password.txt');
const SECRET_FILE = path.join(CONFIG_DIR, 'secret.txt');

const DEFAULT_PORT = Number(process.env.THECHAMBERS_PORT || 3002);

const TAILSCALE_BINARIES = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
];

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function git(args) {
  try {
    return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true})
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function tailscaleIp() {
  for (const binary of TAILSCALE_BINARIES) {
    try {
      const out = execFileSync(binary, ['ip', '-4'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const ip = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (ip) return ip;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

function cliEntry() {
  if (process.env.CMDC_ENTRY) return process.env.CMDC_ENTRY;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const roots = [];
  try {
    const root = execFileSync(npm, ['root', '-g'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
      .split(/\r?\n/)[0]
      .trim();
    if (root) roots.push(root);
  } catch {
    /* npm may be missing; the list below still covers the usual layouts */
  }
  roots.push(
    '/opt/homebrew/lib/node_modules',
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules'),
  );
  for (const root of roots) {
    if (!root) continue;
    const candidate = path.join(root, 'command-code', 'dist', 'index.mjs');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function portOpen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code !== 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function pidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {encoding: 'utf8', windowsHide: true});
      const row = out
        .split(/\r?\n/)
        .find((line) => line.includes('LISTENING') && new RegExp(`[.:]${port}\\s`).test(line));
      if (!row) return null;
      const parts = row.trim().split(/\s+/);
      return Number(parts[parts.length - 1]) || null;
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).trim();
    return out ? Number(out.split(/\r?\n/)[0]) : null;
  } catch {
    return null;
  }
}

function banner(host, port) {
  const ip = host || '127.0.0.1';
  const commit = git(['rev-parse', '--short', 'HEAD']);
  console.log('');
  console.log('  +---+  THECHAMBERS');
  console.log('  | C |  Command Code from your phone, over Tailscale');
  console.log(`  +---+  v${version()}${commit ? ` - ${commit}` : ''}`);
  console.log('');
  console.log(`  phone     http://${ip}:${port}`);
  if (ip !== '127.0.0.1') console.log(`  desktop   http://127.0.0.1:${port}`);
  console.log(`  password  ${PASSWORD_FILE}`);
}

function usage() {
  console.log(`thechambers ${version()} — Command Code from your phone, over Tailscale

usage:
  thechambers [start] [options]   start the server (default command)
  thechambers status              is it running, and on which address
  thechambers stop                stop the process listening on the port
  thechambers doctor              check node, the CLI, Tailscale, the port
  thechambers version             print the version and commit
  thechambers help                this text

start options:
  --port <n>          port to bind (default ${DEFAULT_PORT})
  --host <addr>       bind this address instead of the Tailscale one
  --workspace <dir>   folder new chats start in (default: home)
  --local             loopback only, no phone access

environment:
  THECHAMBERS_PORT, THECHAMBERS_HOST, THECHAMBERS_WORKSPACE, CMDC_ENTRY

Not affiliated with Command Code or prior art.`);
}

async function start(args) {
  const options = {port: DEFAULT_PORT, host: null, workspace: os.homedir(), local: false};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === 'start' || arg === '--') continue;
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length));
    else if (arg === '--host') options.host = args[++i];
    else if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length);
    else if (arg === '--workspace') options.workspace = args[++i];
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length);
    else if (arg === '--local') options.local = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      return 0;
    } else {
      console.error(`thechambers: unknown option '${arg}'`);
      return 2;
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error('thechambers: --port needs a number between 1 and 65535');
    return 2;
  }

  let host = options.host;
  if (!host) host = options.local ? '127.0.0.1' : tailscaleIp();
  if (!host) {
    console.error('thechambers: Tailscale is not running, so the phone will not reach this.');
    console.error('             Start Tailscale, or pass --local to bind loopback only.');
    return 1;
  }

  fs.mkdirSync(CONFIG_DIR, {recursive: true});

  if (!(await portOpen(options.port, host))) {
    console.error(`thechambers: port ${options.port} is already in use on ${host}`);
    return 1;
  }

  const workspace = path.resolve(options.workspace);
  if (!fs.existsSync(workspace)) {
    console.error(`thechambers: workspace does not exist: ${workspace}`);
    return 1;
  }

  banner(host, options.port);
  console.log('');

  const child = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env: {
      ...process.env,
      THECHAMBERS_HOST: host,
      THECHAMBERS_PORT: String(options.port),
      THECHAMBERS_WORKSPACE: workspace,
    },
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }

  return new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve(signal ? 0 : code ?? 0));
  });
}

async function status() {
  const info = await health(DEFAULT_PORT);
  if (!info) {
    console.log(`thechambers: not running on port ${DEFAULT_PORT}`);
    return 1;
  }
  const host = info.host || '127.0.0.1';
  console.log(`thechambers: running on port ${DEFAULT_PORT}`);
  console.log(`  version   ${info.version}${info.commit ? ` (${info.commit})` : ''}`);
  console.log(`  workspace ${info.workspace}`);
  console.log(`  turns     ${info.running} in flight`);
  if (host !== '127.0.0.1') console.log(`  phone     http://${host}:${DEFAULT_PORT}`);
  console.log(`  desktop   http://127.0.0.1:${DEFAULT_PORT}`);
  return 0;
}

function stop() {
  const pid = pidOnPort(DEFAULT_PORT);
  if (!pid) {
    console.log(`thechambers: nothing is listening on port ${DEFAULT_PORT}`);
    return 1;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {windowsHide: true});
    } catch {
      console.error(`thechambers: could not stop pid ${pid}`);
      return 1;
    }
  }
  console.log(`thechambers: stopped pid ${pid} on port ${DEFAULT_PORT}`);
  return 0;
}

async function doctor() {
  let failures = 0;
  const line = (ok, label, detail) => {
    if (!ok) failures += 1;
    console.log(`${ok ? '  ok  ' : '  !!  '}${label}${detail ? `  ${detail}` : ''}`);
  };

  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 22, 'node', `v${process.versions.node}${major >= 22 ? '' : ' (22 or newer required)'}`);

  const entry = cliEntry();
  line(Boolean(entry), 'command code CLI', entry || 'not found — npm i -g command-code');
  if (entry) {
    try {
      const out = execFileSync(process.execPath, [entry, '--version'], {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      }).trim();
      line(true, 'cli version', out.split(/\r?\n/)[0]);
    } catch {
      line(false, 'cli version', 'could not run cmdc --version');
    }
  }

  const ip = tailscaleIp();
  line(Boolean(ip), 'tailscale', ip || 'not running — the phone will not reach this');
  line(fs.existsSync(PASSWORD_FILE), 'password file', fs.existsSync(PASSWORD_FILE) ? PASSWORD_FILE : 'created on first start');
  line(fs.existsSync(SECRET_FILE), 'server secret', fs.existsSync(SECRET_FILE) ? SECRET_FILE : 'created on first start');

  if (!(await health(DEFAULT_PORT))) {
    const free = await portOpen(DEFAULT_PORT, ip || '127.0.0.1');
    line(free, `port ${DEFAULT_PORT}`, free ? 'free' : 'in use by something else');
  } else {
    line(true, `port ${DEFAULT_PORT}`, 'serving');
  }

  console.log('');
  console.log(failures ? `${failures} check(s) need attention` : 'all checks passed');
  return failures ? 1 : 0;
}

const argv = process.argv.slice(2);
let [command, ...rest] = argv;

// Options may come before the command: `thechambers --port 3003` is a start.
const helpFlags = new Set(['--version', '-v', '--help', '-h']);
if (command && command.startsWith('-') && !helpFlags.has(command)) {
  rest = argv;
  command = 'start';
}

let code;
switch (command) {
  case undefined:
  case 'start':
    code = await start(rest);
    break;
  case 'status':
    code = await status();
    break;
  case 'stop':
    code = stop();
    break;
  case 'doctor':
    code = await doctor();
    break;
  case 'version':
  case '--version':
  case '-v': {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    console.log(`thechambers ${version()}${commit ? ` (${commit})` : ''}`);
    code = 0;
    break;
  }
  case 'help':
  case '--help':
  case '-h':
    usage();
    code = 0;
    break;
  default:
    console.error(`thechambers: unknown command '${command}'`);
    console.error('Run `thechambers help` for usage.');
    code = 2;
}

process.exit(typeof code === 'number' ? code : 0);
