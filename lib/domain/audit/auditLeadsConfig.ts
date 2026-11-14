/**
 * Whether the "businesses that may need you" block is on. Off unless the owner sets PUBLIC_AUDIT_LEADS_ENABLED=true,
 * because each lookup spends a web search and a model call on behalf of an anonymous visitor. Hosted only: it uses
 * the platform's search and model keys.
 */
export function auditLeadsEnabled(env: Record<string, string | undefined>, hosted: boolean): boolean {
  return hosted && env.PUBLIC_AUDIT_LEADS_ENABLED === "true";
}

/**
 * Whether the "sample posts" block is on. Separate from the leads switch: it spends model calls, not web searches, and
 * the owner may want one without the other. Off unless PUBLIC_AUDIT_POSTS_ENABLED=true; hosted only.
 */
export function auditPostsEnabled(env: Record<string, string | undefined>, hosted: boolean): boolean {
  return hosted && env.PUBLIC_AUDIT_POSTS_ENABLED === "true";
}
