// TheChambers plugin entry.
//
// This runs in the server process with full access to the machine. Keep it small, catch your own
// errors, and never log credentials. See ../README.md for the full contract.

export default function register(api) {
  api.log('loaded');

  api.route('GET', 'hello', async (ctx) =>
    ctx.json({ok: true, plugin: api.id, at: new Date().toISOString()}),
  );

  api.route('POST', 'echo', async (ctx) => {
    const body = await ctx.body();
    return ctx.json({echo: body});
  });
}
