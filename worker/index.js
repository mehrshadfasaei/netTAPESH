// TEMPORARY minimal test — no imports, no bindings, nothing but a
// static string. If this ALSO throws "Worker threw exception" on every
// request, the problem isn't in this repo's application code at all;
// it's something about the Cloudflare project/deployment itself. Will
// be restored to the real router once that's confirmed either way.
export default {
  async fetch() {
    return new Response("hello from nettapesh worker");
  },
};
