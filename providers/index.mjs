// Provider registry. Built-ins live in this folder; drop-ins are read from the user's config
// directory so a new agent can be added without forking the project.
//
// Contract and a worked example: providers/README.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import cmdc from './cmdc.mjs';

export const EXTERNAL_DIR = path.join(os.homedir(), '.config', 'thechambers', 'providers');

async function loadExternal() {
  const loaded = [];
  let files = [];
  try {
    files = fs.readdirSync(EXTERNAL_DIR);
  } catch {
    return loaded;
  }
  for (const name of files) {
    if (!name.endsWith('.mjs')) continue;
    try {
      const module = await import(pathToFileURL(path.join(EXTERNAL_DIR, name)).href);
      const provider = module.default;
      if (provider && typeof provider.id === 'string' && typeof provider.turnArgs === 'function') {
        loaded.push(provider);
      } else {
        console.error(`[thechambers] provider ${name} does not export a valid default provider`);
      }
    } catch (err) {
      console.error(`[thechambers] could not load provider ${name}: ${err.message}`);
    }
  }
  return loaded;
}

export async function loadProviders() {
  const external = await loadExternal();
  const seen = new Set([cmdc.id]);
  const all = [cmdc];
  for (const provider of external) {
    if (seen.has(provider.id)) {
      console.error(`[thechambers] ignoring duplicate provider id '${provider.id}' from ${EXTERNAL_DIR}`);
      continue;
    }
    seen.add(provider.id);
    all.push(provider);
  }
  return all;
}

export function selectProvider(providers, id) {
  return providers.find((provider) => provider.id === id) || providers[0];
}

export function describeProviders(providers, activeId) {
  return providers.map((provider) => {
    let available = {ok: true, detail: ''};
    try {
      available = provider.available ? provider.available() : available;
    } catch (err) {
      available = {ok: false, detail: err.message};
    }
    return {
      id: provider.id,
      label: provider.label || provider.id,
      docs: provider.docs || null,
      capabilities: provider.capabilities || {},
      modes: (provider.modes || []).map((mode) => ({id: mode.id, label: mode.label})),
      available: Boolean(available.ok),
      detail: available.detail || '',
      active: provider.id === activeId,
    };
  });
}
