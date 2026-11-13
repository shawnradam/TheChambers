#!/usr/bin/env node
// Portable launcher. Works the same on Windows, macOS and Linux:
//
//   node bin/thechambers.mjs [--port 3002] [--host <addr>] [--workspace <dir>] [--local]
//
// It resolves the Tailscale address, makes sure the config directory exists, checks the port, and
// then hands over to server.mjs in the foreground. Ctrl+C stops everything.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'thechambers');
const PASSWORD_FILE = path.join(CONFIG_DIR, 'ui-password.txt');

const args = process.argv.slice(2);
const options = {port: 3002, host: null, workspace: os.homedir(), local: false};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 6).join('\n'));
    process.exit(0);
  } else if (arg === '--port') options.port = Number(args[++i]);
  else if (arg === '--host') options.host = args[++i];
  else if (arg === '--workspace') options.workspace = args[++i];
  else if (arg === '--local') options.local = true;
  else {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  console.error('--port needs a number between 1 and 65535.');
  process.exit(2);
}

const tailscaleBinaries = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
];

function tailscaleIp() {
  for (const binary of tailscaleBinaries) {
    try {
      const out = execFileSync(binary, ['ip', '-4'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const ip = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (ip) return ip;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

let host = options.host;
if (!host) {
  host = options.local ? '127.0.0.1' : tailscaleIp();
}
if (!host) {
  console.error('Tailscale is not running, so the phone will not reach this.');
  console.error('Start Tailscale, or pass --local to bind loopback only.');
  process.exit(1);
}

fs.mkdirSync(CONFIG_DIR, {recursive: true});
if (!fs.existsSync(PASSWORD_FILE) || !fs.readFileSync(PASSWORD_FILE, 'utf8').trim()) {
  console.log(`Generating a password at ${PASSWORD_FILE}`);
}

const free = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (err) => resolve(err.code !== 'EADDRINUSE'));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(options.port, host);
});

if (!free) {
  console.error(`Port ${options.port} is already in use on ${host}. Pass --port with another value.`);
  process.exit(1);
}

const workspace = path.resolve(options.workspace);
if (!fs.existsSync(workspace)) {
  console.error(`Workspace does not exist: ${workspace}`);
  process.exit(1);
}

console.log('');
console.log(`Open on the phone:   http://${host}:${options.port}`);
if (host !== '127.0.0.1') console.log(`Open on this machine: http://127.0.0.1:${options.port}`);
console.log(`Password file:       ${PASSWORD_FILE}`);
console.log(`Workspace:           ${workspace}`);
console.log('Press Ctrl+C to stop.');
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

const forward = (signal) => child.kill(signal);
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  process.exit(signal ? 0 : code ?? 0);
});
