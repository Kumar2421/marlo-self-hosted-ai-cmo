/**
 * Response headers applied to every route by next.config.ts (headers()).
 * Kept as pure data so tests can assert the exact list.
 */
export type SecurityHeader = { key: string; value: string };

/**
 * Conservative CSP, shipped as Content-Security-Policy-Report-Only so nothing
 * breaks: violations are reported, never blocked. Next.js needs inline and eval
 * script without nonces, hence 'unsafe-inline' and 'unsafe-eval'.
 *
 * connect-src covers the only origins the browser calls: Supabase (auth and
 * data over https and wss) and the dotlottie player's wasm, which
 * @lottiefiles/dotlottie-web fetches from cdn.jsdelivr.net, with unpkg.com as
 * its fallback. 'wasm-unsafe-eval' lets that wasm compile under script-src.
 *
 * To enforce later: rename the header to Content-Security-Policy after one
 * clean report window, and re-check the report sink before flipping.
 */
export const CSP_REPORT_ONLY_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://unpkg.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export function buildSecurityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    // Vercel serves only https, so HSTS is safe to send from the app itself.
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY_DIRECTIVES.join("; ") },
  ];
}
