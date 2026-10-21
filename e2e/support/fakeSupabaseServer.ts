import http from "node:http";

/**
 * Tiny local stand-in for Supabase, used only by the dashboard layout e2e.
 *
 * proxy.ts calls supabase.auth.getUser() on the server for /dashboard, and that
 * request cannot be intercepted by page.route(). This server answers it (and the
 * token / REST calls the browser client may make) so the dashboard renders for a
 * signed-in test user. It stores nothing and is never a real backend.
 *
 * Run: node --experimental-strip-types e2e/support/fakeSupabaseServer.ts
 * Port: FAKE_SUPABASE_PORT (default 54329).
 */

const FAKE_USER = {
  id: "00000000-0000-4000-8000-0000000000e2",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-user@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const session = {
  access_token: "e2e.access.token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  refresh_token: "e2e-refresh",
  user: FAKE_USER,
};

const port = Number(process.env.FAKE_SUPABASE_PORT || 54329);
http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    const url = req.url ?? "";
    if (url.startsWith("/health")) return res.end('{"ok":true}');
    if (url.startsWith("/auth/v1/user")) return res.end(JSON.stringify(FAKE_USER));
    if (url.startsWith("/auth/v1/")) return res.end(JSON.stringify(session));
    if (url.startsWith("/rest/v1/")) return res.end(req.method === "GET" ? "[]" : "{}");
    res.end("{}");
  })
  .listen(port, () => console.log(`fake supabase on ${port}`));
