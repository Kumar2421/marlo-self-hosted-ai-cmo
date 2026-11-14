/**
 * Whether the "businesses that may need you" block is on. Off unless the owner sets PUBLIC_AUDIT_LEADS_ENABLED=true,
 * because each lookup spends a web search and a model call on behalf of an anonymous visitor. Hosted only: it uses
 * the platform's search and model keys.
 */
export function auditLeadsEnabled(env: Record<string, string | undefined>, hosted: boolean): boolean {
  return hosted && env.PUBLIC_AUDIT_LEADS_ENABLED === "true";
}
