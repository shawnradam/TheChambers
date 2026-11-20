# Your plugin

This folder is a TheChambers plugin. The manager copied it from `plugins/_template`; it is yours
to edit.

- `plugin.json` — id, name, version, panel, commands, permissions.
- `server.mjs` — default-export `register(api)` and declare routes with `api.route(method, path, handler)`.
- `ui/index.html` — the panel. It runs in an iframe at `/plugin-assets/<id>/index.html`, so call
  your server routes with `fetch('/api/plugin/<id>/…')`.

Edit the files, then open **Settings → Plugins → Reload**. If the plugin starts background work,
Reload cannot stop it; restart TheChambers for a clean unload.

The full contract is in `plugins/README.md` in the repository.
