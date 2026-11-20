// Load one plugin the way the server does, without starting the server.
//
//   node tools/plugin-check.mjs <id>

import {loadPlugins, listPluginRecords, getPlugin} from '../plugins/index.mjs';

const id = process.argv[2];

if (!id) {
  await loadPlugins({settings: {plugins: {}}, log: () => {}});
  const plugins = listPluginRecords();
  console.log('Usage: node tools/plugin-check.mjs <id>\n');
  if (!plugins.length) {
    console.log('No plugins found.');
  } else {
    console.log('Plugins:');
    for (const plugin of plugins) {
      console.log(`  ${plugin.id.padEnd(18)} ${plugin.source.padEnd(7)} ${plugin.name}`);
    }
  }
  process.exit(0);
}

const settings = {plugins: {[id]: {enabled: true, trustedAt: Date.now()}}};
await loadPlugins({settings, log: (message) => console.log(message)});

const record = getPlugin(id);
if (!record) {
  console.error(`No plugin '${id}' in plugins/ or ~/.config/thechambers/plugins/`);
  process.exit(1);
}

console.log(`plugin      ${record.id}`);
console.log(`name        ${record.manifest.name || ''}`);
console.log(`version     ${record.manifest.version || ''}`);
console.log(`source      ${record.source}`);
console.log(`folder      ${record.dir}`);
console.log(`panel       ${record.panel ? `${record.panel.title} (${record.panel.icon})` : 'none'}`);
console.log(`ui          ${record.uiEntry || 'none'}`);
console.log(`commands    ${record.commands.map((command) => `/${command.name}`).join(' ') || 'none'}`);
console.log(`routes      ${record.routes.length}`);
for (const route of record.routes) {
  console.log(`  ${route.method.padEnd(6)} /api/plugin/${record.id}/${route.path}`);
}
for (const entry of record.logs.slice(-10)) {
  console.log(`log         ${entry.message}`);
}

if (record.error) {
  console.error(`\nFAILED: ${record.error}`);
  process.exit(1);
}
if (!record.loaded) {
  console.error('\nFAILED: the plugin did not load.');
  process.exit(1);
}
console.log('\nOK');
