/**
 * The UI gallery is a developer tool. It is served only when BOTH hold:
 *  - NODE_ENV is not "production" (next build/start and every Vercel deploy set it), and
 *  - platform (hosted) mode is off.
 * Either condition alone is enough to 404 it, so a hosted deployment cannot expose it.
 */
export function isUiGalleryEnabled(opts: { nodeEnv: string | undefined; platformMode: boolean }): boolean {
  return opts.nodeEnv !== "production" && !opts.platformMode;
}
