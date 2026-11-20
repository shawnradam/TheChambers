// Plugin registry. Bundled plugins live in this folder; user plugins live in the config directory
// and override a bundled plugin with the same id. Only enabled plugins are imported, and a failing
// plugin never blocks the rest.
//
// Contract and a worked example: plugins/README.md
//
// Trust model: an enabled plugin runs Node.js code in this process with full access to the machine.
// There is no sandbox. That is why discovery never enables anything by itself and the manager asks
// for explicit trust before the first load.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BUNDLED_DIR = HERE;
export const PLUGINS_DIR = path.join(os.homedir(), '.config', 'thechambers', 'plugins');
export const PLUGIN_DATA_DIR = path.join(os.homedir(), '.config', 'thechambers', 'plugin-data');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const ICONS = new Set(['globe', 'folder', 'cloud', 'terminal', 'plug', 'book']);
const SKIP_DIRS = new Set(['_template', 'node_modules', '.git', '.trash']);

const registry = new Map();
let settingsRef = {plugins: {}};
let logger = () => {};

export function pluginIdValid(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safePath(root, rel) {
  const target = path.resolve(root, rel || '');
  return inside(root, target) ? target : null;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonPrivate(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {mode: 0o600});
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows does not implement POSIX modes; the file still lives under the user profile */
  }
}

function normaliseRoute(value) {
  return String(value || '')
    .replace(/^\/+|\/+$/g, '');
}

function readManifest(dir, source) {
  const manifestFile = path.join(dir, 'plugin.json');
  if (!fs.existsSync(manifestFile)) throw new Error('plugin.json is missing');
  const raw = readJson(manifestFile, null);
  if (!raw || typeof raw !== 'object') throw new Error('plugin.json is not valid JSON');

  const id = typeof raw.id === 'string' ? raw.id : path.basename(dir);
  if (!pluginIdValid(id)) throw new Error('id must be lowercase letters, numbers and hyphens');
  if (id !== path.basename(dir)) throw new Error(`id '${id}' must match the folder name`);

  const mainRel = typeof raw.main === 'string' && raw.main ? raw.main : 'server.mjs';
  const main = safePath(dir, mainRel);
  if (!main || !fs.existsSync(main)) throw new Error(`entry '${mainRel}' does not exist`);

  let ui = null;
  let uiRoot = null;
  let uiEntry = null;
  if (typeof raw.ui === 'string' && raw.ui.trim()) {
    const file = safePath(dir, raw.ui);
    if (file && fs.existsSync(file)) {
      ui = file;
      uiRoot = path.dirname(file);
      uiEntry = path.relative(uiRoot, file).split(path.sep).join('/');
    }
  }

  const panel =
    raw.panel && typeof raw.panel === 'object'
      ? {
          title: String(raw.panel.title || raw.name || id),
          icon: ICONS.has(raw.panel.icon) ? raw.panel.icon : 'plug',
        }
      : null;

  const commands = Array.isArray(raw.commands)
    ? raw.commands
        .filter((command) => command && typeof command.name === 'string')
        .map((command) => ({
          name: command.name.replace(/^\//, ''),
          description: String(command.description || ''),
          action: command.action === 'insert' ? 'insert' : 'panel',
          text: typeof command.text === 'string' ? command.text : '',
        }))
    : [];

  return {
    manifest: {...raw, id},
    source,
    dir,
    main,
    ui,
    uiRoot,
    uiEntry,
    panel: panel && ui ? panel : panel,
    commands,
  };
}

function scanManifests() {
  const found = new Map();
  const add = (root, source) => {
    let entries = [];
    try {
      entries = fs.readdirSync(root, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const dir = path.join(root, entry.name);
      if (!fs.existsSync(path.join(dir, 'plugin.json'))) continue;
      try {
        const meta = readManifest(dir, source);
        found.set(meta.manifest.id, meta);
      } catch (err) {
        found.set(entry.name, {
          manifest: {id: entry.name, name: entry.name, version: '0.0.0', description: ''},
          source,
          dir,
          main: null,
          ui: null,
          uiRoot: null,
          uiEntry: null,
          panel: null,
          commands: [],
          invalid: err.message,
        });
      }
    }
  };
  fs.mkdirSync(PLUGINS_DIR, {recursive: true, mode: 0o700});
  add(BUNDLED_DIR, 'bundled');
  add(PLUGINS_DIR, 'user');
  return [...found.values()].sort((a, b) =>
    String(a.manifest.name || a.manifest.id).localeCompare(String(b.manifest.name || b.manifest.id)),
  );
}

function configApi(record) {
  const file = path.join(PLUGIN_DATA_DIR, record.id, 'config.json');
  const read = () => readJson(file, {}) || {};
  const write = (value) => {
    writeJsonPrivate(file, value);
    return value;
  };
  return {
    get: () => read(),
    set: (patch) => write({...read(), ...(patch && typeof patch === 'object' ? patch : {})}),
    replace: (value) => write(value && typeof value === 'object' ? value : {}),
  };
}

function makeApi(record) {
  return {
    id: record.id,
    dir: record.dir,
    dataDir: path.join(PLUGIN_DATA_DIR, record.id),
    config: configApi(record),
    log(message) {
      const line = String(message);
      record.logs.push({at: Date.now(), message: line});
      if (record.logs.length > 200) record.logs.shift();
      logger(`[plugin:${record.id}] ${line}`);
    },
    route(method, routePath, handler) {
      if (typeof handler !== 'function') throw new Error('a route handler must be a function');
      record.routes.push({
        method: String(method || 'GET').toUpperCase(),
        path: normaliseRoute(routePath),
        handler,
      });
    },
    panel(meta) {
      if (!meta || typeof meta !== 'object') return;
      record.panel = {
        title: String(meta.title || record.panel?.title || record.manifest.name || record.id),
        icon: ICONS.has(meta.icon) ? meta.icon : record.panel?.icon || 'plug',
      };
    },
    command(command) {
      if (!command || typeof command.name !== 'string') return;
      record.commands.push({
        name: command.name.replace(/^\//, ''),
        description: String(command.description || ''),
        action: command.action === 'insert' ? 'insert' : 'panel',
        text: typeof command.text === 'string' ? command.text : '',
      });
    },
  };
}

function makeRecord(meta) {
  const saved = settingsRef.plugins?.[meta.manifest.id] || {};
  return {
    id: meta.manifest.id,
    dir: meta.dir,
    source: meta.source,
    manifest: meta.manifest,
    main: meta.main,
    ui: meta.ui,
    uiRoot: meta.uiRoot,
    uiEntry: meta.uiEntry,
    panel: meta.panel,
    commands: [...(meta.commands || [])],
    enabled: Boolean(saved.enabled),
    loaded: false,
    error: meta.invalid || null,
    routes: [],
    logs: [],
  };
}

async function loadRecord(record) {
  record.routes = [];
  record.loaded = false;
  record.error = null;

  if (!record.main) {
    record.error = record.error || 'The plugin has no server entry.';
    return;
  }

  try {
    const stat = fs.statSync(record.main);
    const url = `${pathToFileURL(record.main).href}?v=${stat.mtimeMs}.${Date.now()}`;
    const module = await import(url);
    const register = module.default;
    if (typeof register !== 'function') {
      throw new Error('The server entry must default-export a function.');
    }
    await register(makeApi(record));
    record.loaded = true;
    logger(`[thechambers] plugin ${record.id} loaded (${record.routes.length} routes)`);
  } catch (err) {
    record.error = err && err.message ? err.message : String(err);
    record.loaded = false;
    record.routes = [];
    logger(`[thechambers] plugin ${record.id} failed: ${record.error}`);
    record.logs.push({at: Date.now(), message: `load failed: ${record.error}`});
    if (record.logs.length > 200) record.logs.shift();
  }
}

export function pluginUiUrl(record) {
  if (!record || !record.uiEntry) return null;
  const parts = record.uiEntry.split('/').map((part) => encodeURIComponent(part));
  return `/plugin-assets/${encodeURIComponent(record.id)}/${parts.join('/')}`;
}

function recordView(record) {
  const saved = settingsRef.plugins?.[record.id] || {};
  return {
    id: record.id,
    name: record.manifest.name || record.id,
    version: record.manifest.version || '0.0.0',
    description: record.manifest.description || '',
    author: record.manifest.author || '',
    source: record.source,
    dir: record.dir,
    enabled: Boolean(record.enabled),
    trusted: Boolean(saved.trustedAt),
    loaded: Boolean(record.loaded),
    error: record.error || null,
    panel: record.panel || null,
    commands: record.commands,
    permissions: Array.isArray(record.manifest.permissions) ? record.manifest.permissions : [],
    hasPackage: fs.existsSync(path.join(record.dir, 'package.json')),
    uiUrl: record.loaded ? pluginUiUrl(record) : null,
    logs: record.logs.slice(-30),
  };
}

export async function loadPlugins({settings, log} = {}) {
  if (settings && typeof settings === 'object') settingsRef = settings;
  if (typeof log === 'function') logger = log;
  registry.clear();
  const records = [];
  for (const meta of scanManifests()) {
    const record = makeRecord(meta);
    registry.set(record.id, record);
    if (record.enabled) await loadRecord(record);
    records.push(recordView(record));
  }
  return records;
}

export function listPluginRecords() {
  return [...registry.values()].map((record) => recordView(record));
}

export function getPlugin(id) {
  return registry.get(id) || null;
}

export function findPluginRoute(id, method, subpath) {
  const record = registry.get(id);
  if (!record || !record.loaded) return null;
  const wanted = normaliseRoute(subpath);
  const upper = String(method || 'GET').toUpperCase();
  const route = record.routes
    .filter((entry) => entry.method === upper && entry.path === wanted)
    .sort((a, b) => b.path.length - a.path.length)[0];
  return route ? {record, route} : null;
}

export function pluginConfigApi(id) {
  const record = registry.get(id);
  return record ? configApi(record) : null;
}

export function pluginLog(id, message) {
  const record = registry.get(id);
  if (!record) return;
  const line = String(message);
  record.logs.push({at: Date.now(), message: line});
  if (record.logs.length > 200) record.logs.shift();
  logger(`[plugin:${id}] ${line}`);
}

export function resolvePluginAsset(id, relPath) {
  const record = registry.get(id);
  if (!record || !record.uiRoot) return null;
  const target = path.resolve(record.uiRoot, String(relPath || '').replace(/^\/+/, '') || record.uiEntry || '');
  if (!inside(record.uiRoot, target)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return {file: target, record};
}

export async function setPluginEnabled(id, enabled) {
  const record = registry.get(id);
  if (!record) throw new Error('No such plugin.');
  record.enabled = Boolean(enabled);
  if (record.enabled) {
    await loadRecord(record);
  } else {
    record.loaded = false;
    record.routes = [];
  }
  return recordView(record);
}

export async function reloadPlugin(id) {
  const record = registry.get(id);
  if (!record) throw new Error('No such plugin.');
  if (record.enabled) await loadRecord(record);
  return recordView(record);
}

function copyDir(source, dest, {skip = []} = {}) {
  const skipped = new Set(skip);
  fs.mkdirSync(dest, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (skipped.has(entry.name) || entry.name.startsWith('.')) continue;
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, {skip});
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

export function createPluginScaffold({id, name, description = '', panel = true, ui = true}, templateDir) {
  if (!pluginIdValid(id)) {
    throw new Error('Use lowercase letters, numbers and hyphens for the id (2–49 characters).');
  }
  if (!fs.existsSync(templateDir)) throw new Error('The plugin template is missing.');
  const dest = path.join(PLUGINS_DIR, id);
  if (fs.existsSync(dest)) throw new Error('A plugin with that id already exists.');

  copyDir(templateDir, dest);
  const manifest = {
    id,
    name: name || id,
    version: '0.1.0',
    description,
    author: '',
    main: 'server.mjs',
  };
  if (ui) manifest.ui = 'ui/index.html';
  if (panel && ui) manifest.panel = {title: name || id, icon: 'plug'};
  manifest.commands = [{name: id, description: `Open ${name || id}`, action: 'panel'}];
  manifest.permissions = [];
  fs.writeFileSync(path.join(dest, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!ui) fs.rmSync(path.join(dest, 'ui'), {recursive: true, force: true});
  return manifest;
}

export function installPluginFrom(sourceDir) {
  const source = path.resolve(sourceDir);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error('That path is not a folder on this machine.');
  }
  const meta = readManifest(source, 'user');
  const dest = path.join(PLUGINS_DIR, meta.manifest.id);
  if (fs.existsSync(dest)) throw new Error('A plugin with that id is already installed.');
  copyDir(source, dest, {skip: ['.git', 'node_modules', '.trash']});
  return meta.manifest;
}

function pruneTrash() {
  const trash = path.join(PLUGINS_DIR, '.trash');
  let entries = [];
  try {
    entries = fs.readdirSync(trash, {withFileTypes: true});
  } catch {
    return;
  }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(trash, entry.name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, {recursive: true, force: true});
    } catch {
      /* a locked folder waits for the next pass */
    }
  }
}

export function removePlugin(id) {
  const record = registry.get(id);
  if (!record) throw new Error('No such plugin.');
  if (record.source === 'bundled') throw new Error('Bundled plugins cannot be removed.');
  const trash = path.join(PLUGINS_DIR, '.trash');
  fs.mkdirSync(trash, {recursive: true, mode: 0o700});
  const dest = path.join(trash, `${id}-${Date.now()}`);
  fs.renameSync(record.dir, dest);
  registry.delete(id);
  pruneTrash();
  return {trash: dest};
}
