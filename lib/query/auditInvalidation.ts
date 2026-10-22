import { qk } from "./keys.ts";

/**
 * Query keys that go stale when a site audit finishes. The audit saves the project's findings on the
 * server, so any findings list the client cached before then (often an empty one, from before the
 * first audit) must be refetched or Findings, counts and "Fix first" keep showing the old list.
 */
export function queryKeysAfterAudit(projectId: string | undefined): readonly (readonly unknown[])[] {
  return [qk.findings(projectId)];
}
