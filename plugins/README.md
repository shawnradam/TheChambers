# Plugins

A plugin adds a capability to TheChambers without changing the core: an HTTP API, a panel in the
rail, and optional `/` commands. FTP is the first planned plugin, not a core feature.

**Trust boundary:** an enabled plugin runs Node.js code in the server process with full access to
this machine — files, network, child processes. There is no sandbox. Discovery never enables a
plugin by itself; the manager asks for explicit trust before the first load. Only enable code you
would run yourself.

## Where plugins live

| Location | Scope |
| --- | --- |
| `plugins/<id>/` | bundled with TheChambers (e.g. `plugins/ftp`), disabled by default |
| `~/.config/thechambers/plugins/<id>/` | yours; overrides a bundled plugin with the same id |

Plugin state (config, credentials) is stored outside the plugin folder:

```
~/.config/thechambers/plugin-data/<id>/config.json     mode 0600
```

That keeps a bundled plugin's folder clean and makes updates safe.

## Folder contract

```
<plugin>/
  plugin.json          required
  server.mjs           required; default-exports register(api)
  ui/index.html        optional panel
  ui/*.js|css          optional assets
  package.json         optional; dependencies local to the plugin
```

`plugin.json`:

```json
{
  "id": "example",
  "name": "Example plugin",
  "version": "0.1.0",
  "description": "What it does.",
  "author": "",
  "main": "server.mjs",
  "ui": "ui/index.html",
  "panel": { "title": "Example", "icon": "plug" },
  "commands": [
    { "name": "example", "description": "Open the example panel", "action": "panel" }
  ],
  "permissions": ["network"]
}
```

- `id` — `^[a-z0-9][a-z0-9-]{1,48}$` and **must equal the folder name**.
- `main` — resolved inside the plugin folder; path traversal is rejected.
- `ui` — HTML entry; its directory becomes the asset root.
- `panel.icon` — one of `globe`, `folder`, `cloud`, `terminal`, `plug`, `book`.
- `commands[].action` — `panel` opens the panel; `insert` inserts `text` into the composer.
- `permissions` — shown in the trust dialog. Informational in v1; not enforced.

## The server entry

```js
export default function register(api) {
  api.log('loaded');
  api.route('GET', 'status', async (ctx) => ctx.json({ok: true, plugin: api.id}));
  api.route('POST', 'echo', async (ctx) => {
    const body = await ctx.body();
    return ctx.json({echo: body});
  });
}
```

Routes are mounted at **`/api/plugin/<id>/<path>`**. The method and path must match exactly; the
path is the part after the plugin id (`''` is the root). Requests are authenticated with the same
cookie as the app and the same-origin check applies to writes.

### `api`

| Member | Meaning |
| --- | --- |
| `id`, `dir` | Plugin id and code folder |
| `dataDir` | `~/.config/thechambers/plugin-data/<id>` |
| `config.get()` | Read the plugin's JSON config |
| `config.set(patch)` / `config.replace(value)` | Merge/replace and persist (mode 0600) |
| `log(message)` | Appears in the manager's plugin log and `server.log` |
| `route(method, path, handler)` | Declare a route; call at load time |
| `panel({title, icon})` | Override the manifest panel metadata |
| `command({name, description, action, text})` | Add a `/` command |

### `ctx`

| Member | Meaning |
| --- | --- |
| `req`, `res`, `url` | Raw Node request/response and parsed URL |
| `method`, `workspace` | HTTP method and the active workspace |
| `body(limit?)` | Parse a JSON body (1 MB default, same cap as core) |
| `json(status, payload)` | Send JSON with no-store headers |
| `text(status, body, type?)` | Send text with an optional content type |
| `config`, `log()` | Same helpers as the load-time API |

A handler may also return a value instead of writing the response; it is sent as JSON 200.

## The panel

`ui/index.html` is served from `/plugin-assets/<id>/<path>` and opened in an iframe inside the
panel. It is same-origin, so `fetch('/api/plugin/<id>/…')` carries the session cookie. The asset
root is the directory containing `ui`; files outside it are refused. Plugin pages get a CSP that
allows inline scripts/styles (the code is already trusted), but no framing by other origins.

## Dependencies

Core stays dependency-free. A plugin may ship its own `package.json`; install it in the plugin
folder:

```bash
cd ~/.config/thechambers/plugins/<id>
npm install --omit=dev
```

The manager also has **Install dependencies**, which runs that command for you. Node resolves the
imports relative to the plugin's `server.mjs`, so `import 'basic-ftp'` works after installation.

## Lifecycle

- **Enable** — first time requires the trust dialog; then the file is imported and routes/panels
  become live. A failed import is shown in the manager and does not affect other plugins.
- **Reload** — re-imports with a cache-busted URL and replaces routes. Background timers or open
  sockets started by the old module are **not** stopped; restart the server for a clean unload.
- **Disable** — removes routes and the rail panel. It does not cancel work already running.
- **Remove** — user plugins move to `plugins/.trash/<id>-<timestamp>` and are pruned after 30 days.
  Bundled plugins cannot be removed.

## Testing while developing

```bash
node tools/plugin-check.mjs <id>     # load one plugin, print routes/panel/errors
thechambers doctor                   # server, port, Tailscale, CLI
```

Then enable it in **Settings → Plugins**, open the panel, and call a route from the UI.

## Checklist

- [ ] `id` matches the folder name and is lowercase
- [ ] `main` exists and default-exports `register`
- [ ] routes use exact paths and handle their own errors
- [ ] no credentials in logs, responses, or the plugin folder
- [ ] panel works at phone width; `fetch` uses relative `/api/plugin/<id>/…` URLs
- [ ] `node tools/plugin-check.mjs <id>` reports it loaded
