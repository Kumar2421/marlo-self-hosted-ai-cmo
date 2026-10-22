import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IntegrationResource,
  IntegrationSecrets,
  IntegrationType,
  ProjectIntegration,
} from "./integrationTypes";
import { chooseSelectedResourceId } from "./resourceSelection.ts";
import type { ConnectionHealth } from "./connectionStatus.ts";

/** Supabase mirror of integrationStore.ts (self-host, SQLite) — same
 * function names and shapes, so both platform-mode and self-host routes
 * read/write the exact same contract, just against a different backend.
 * Platform mode needs an explicit userId (RLS-equivalent enforcement via
 * the service-role client) that self-host has no use for. */

// integrationTypes.ts's IntegrationType ('google-search-console' |
// 'google-analytics') maps onto integration_connections.provider ('gsc' | 'ga4').
function providerFor(integrationType: IntegrationType): "ga4" | "gsc" {
  return integrationType === "google-analytics" ? "ga4" : "gsc";
}
function integrationTypeFor(provider: string): IntegrationType {
  return provider === "ga4" ? "google-analytics" : "google-search-console";
}
// integration_resources.resource_type strings, matching self-host's exactly.
function resourceTypeFor(integrationType: IntegrationType): string {
  return integrationType === "google-analytics" ? "ga4_property" : "search_console_property";
}

type ConnectionRow = {
  id: string;
  project_id: string | null;
  provider: string;
  external_email: string | null;
  created_at: string;
  updated_at: string;
};

function mapIntegration(row: ConnectionRow): ProjectIntegration {
  return {
    id: row.id,
    projectId: row.project_id ?? "",
    provider: "google",
    integrationType: integrationTypeFor(row.provider),
    status: "connected",
    accountIdentifier: row.external_email,
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProjectIntegration(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  integrationType: IntegrationType
): Promise<ProjectIntegration | null> {
  const { data } = await db
    .from("integration_connections")
    .select("id, project_id, provider, external_email, created_at, updated_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("provider", providerFor(integrationType))
    .maybeSingle();
  return data ? mapIntegration(data as ConnectionRow) : null;
}

export async function listProjectIntegrations(
  db: SupabaseClient,
  userId: string,
  projectId: string
): Promise<ProjectIntegration[]> {
  const { data } = await db
    .from("integration_connections")
    .select("id, project_id, provider, external_email, created_at, updated_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .in("provider", ["ga4", "gsc"]);
  return (data ?? []).map((row) => mapIntegration(row as ConnectionRow));
}

export async function upsertProjectIntegration(
  db: SupabaseClient,
  userId: string,
  input: {
    projectId: string;
    integrationType: IntegrationType;
    accountIdentifier?: string | null;
    connectedAt?: string;
  }
): Promise<ProjectIntegration> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("integration_connections")
    .upsert(
      {
        user_id: userId,
        project_id: input.projectId,
        provider: providerFor(input.integrationType),
        external_email: input.accountIdentifier ?? null,
        created_at: input.connectedAt ?? now,
        updated_at: now,
      },
      { onConflict: "user_id,project_id,provider" }
    )
    .select("id, project_id, provider, external_email, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return mapIntegration(data as ConnectionRow);
}

export async function saveIntegrationSecrets(
  db: SupabaseClient,
  userId: string,
  integrationId: string,
  secrets: IntegrationSecrets
): Promise<void> {
  const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
    await Promise.all([
      db.rpc("vault_set_secret", { p_secret: secrets.accessToken, p_name: `integration_token:${integrationId}:access` }),
      db.rpc("vault_set_secret", { p_secret: secrets.refreshToken, p_name: `integration_token:${integrationId}:refresh` }),
    ]);
  if (accessErr || refreshErr) throw new Error(accessErr?.message ?? refreshErr?.message);

  const { error } = await db
    .from("integration_connections")
    .update({
      access_token_secret_id: accessSecretId as string,
      refresh_token_secret_id: refreshSecretId as string,
      token_expiry: new Date(secrets.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  // Fresh credentials clear an earlier needs_reconnect flag. Best effort: the health
  // columns come from a separate migration and may not exist yet.
  await clearConnectionHealth(db, userId, integrationId);
}

/**
 * Connection health lives in integration_connections.status / last_error_code /
 * last_error_at (migration 20261021000000). Every helper tolerates the columns
 * being absent: writes are swallowed, reads return null.
 */
export async function markConnectionNeedsReconnect(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  integrationType: IntegrationType,
  errorCode: string,
): Promise<void> {
  try {
    await db
      .from("integration_connections")
      .update({ status: "needs_reconnect", last_error_code: errorCode, last_error_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("provider", providerFor(integrationType));
  } catch {
    // Column missing or write refused: health is advisory.
  }
}

export async function clearConnectionHealth(db: SupabaseClient, userId: string, integrationId: string): Promise<void> {
  try {
    await db
      .from("integration_connections")
      .update({ status: "connected", last_error_code: null, last_error_at: null })
      .eq("id", integrationId)
      .eq("user_id", userId)
      .eq("status", "needs_reconnect");
  } catch {
    // See markConnectionNeedsReconnect.
  }
}

/** Health of each Google row of a project (gsc and ga4); empty when the columns do not exist. */
export async function listConnectionHealth(db: SupabaseClient, userId: string, projectId: string): Promise<ConnectionHealth[]> {
  try {
    const { data, error } = await db
      .from("integration_connections")
      .select("status, last_error_code, last_error_at")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .in("provider", ["ga4", "gsc"]);
    if (error) return [];
    return (data ?? []).map((row) => ({
      status: (row.status as string | null) ?? null,
      lastErrorCode: (row.last_error_code as string | null) ?? null,
      lastErrorAt: (row.last_error_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getIntegrationSecrets(
  db: SupabaseClient,
  userId: string,
  integrationId: string
): Promise<IntegrationSecrets | null> {
  const { data: conn } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("id", integrationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn?.access_token_secret_id || !conn.refresh_token_secret_id) return null;

  const [{ data: accessToken }, { data: refreshToken }] = await Promise.all([
    db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id }),
    db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id }),
  ]);
  if (!accessToken || !refreshToken) return null;

  return {
    accessToken: accessToken as string,
    refreshToken: refreshToken as string,
    expiresAt: conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0,
  };
}

export async function replaceIntegrationResources(
  db: SupabaseClient,
  userId: string,
  integrationId: string,
  resources: Omit<IntegrationResource, "id" | "integrationId" | "selected">[],
  selectedResourceId?: string | null
): Promise<IntegrationResource[]> {
  // Reconnecting rebuilds the list; keep the user's earlier pick when Google still lists it.
  const { data: previous } = await db
    .from("integration_resources")
    .select("resource_id")
    .eq("connection_id", integrationId)
    .eq("selected", true)
    .limit(1)
    .maybeSingle();
  const keepId = chooseSelectedResourceId(
    resources.map((resource) => resource.resourceId),
    (previous?.resource_id as string | undefined) ?? null,
    selectedResourceId,
  );

  const { error: delErr } = await db.from("integration_resources").delete().eq("connection_id", integrationId);
  if (delErr) throw new Error(delErr.message);

  if (resources.length > 0) {
    const rows = resources.map((resource) => ({
      connection_id: integrationId,
      user_id: userId,
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      resource_name: resource.resourceName,
      metadata: resource.metadata ?? {},
      selected: keepId !== null && resource.resourceId === keepId,
    }));
    const { error: insErr } = await db.from("integration_resources").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  return listIntegrationResources(db, userId, integrationId);
}

export async function listIntegrationResources(
  db: SupabaseClient,
  userId: string,
  integrationId: string
): Promise<IntegrationResource[]> {
  const { data } = await db
    .from("integration_resources")
    .select("id, connection_id, resource_type, resource_id, resource_name, metadata, selected")
    .eq("connection_id", integrationId)
    .eq("user_id", userId)
    .order("resource_name");

  return (data ?? []).map((row) => ({
    id: row.id,
    integrationId: row.connection_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    selected: row.selected,
  }));
}

export async function selectIntegrationResource(
  db: SupabaseClient,
  userId: string,
  integrationId: string,
  resourceId: string
): Promise<boolean> {
  const { data: resource } = await db
    .from("integration_resources")
    .select("id")
    .eq("connection_id", integrationId)
    .eq("user_id", userId)
    .eq("resource_id", resourceId)
    .maybeSingle();
  if (!resource) return false;

  await db.from("integration_resources").update({ selected: false }).eq("connection_id", integrationId).eq("user_id", userId);
  const { error } = await db
    .from("integration_resources")
    .update({ selected: true })
    .eq("connection_id", integrationId)
    .eq("user_id", userId)
    .eq("resource_id", resourceId);
  if (error) throw new Error(error.message);

  await db.from("integration_connections").update({ updated_at: new Date().toISOString() }).eq("id", integrationId).eq("user_id", userId);
  return true;
}

export async function getSelectedIntegrationResource(
  db: SupabaseClient,
  userId: string,
  integrationId: string,
  resourceType: string
): Promise<IntegrationResource | null> {
  const { data } = await db
    .from("integration_resources")
    .select("id, connection_id, resource_type, resource_id, resource_name, metadata, selected")
    .eq("connection_id", integrationId)
    .eq("user_id", userId)
    .eq("resource_type", resourceType)
    .eq("selected", true)
    .maybeSingle();

  return data
    ? {
        id: data.id,
        integrationId: data.connection_id,
        resourceType: data.resource_type,
        resourceId: data.resource_id,
        resourceName: data.resource_name,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
        selected: true,
      }
    : null;
}

export async function deleteProjectIntegration(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  integrationType: IntegrationType
): Promise<void> {
  // ON DELETE CASCADE on integration_resources.connection_id handles the
  // resource rows; the vault secret rows are left orphaned (same tradeoff
  // self-host's disconnect route notes — acceptable, not a live credential
  // once nothing references it).
  const { error } = await db
    .from("integration_connections")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("provider", providerFor(integrationType));
  if (error) throw new Error(error.message);
}

// resourceTypeFor is exported for callers building resource rows to pass to
// replaceIntegrationResources (e.g. the OAuth callback route).
export { resourceTypeFor };

export async function getSelectedSearchConsoleSite(db: SupabaseClient, userId: string, projectId: string): Promise<string | null> {
  const integration = await getProjectIntegration(db, userId, projectId, "google-search-console");
  if (!integration) return null;
  const resource = await getSelectedIntegrationResource(db, userId, integration.id, "search_console_property");
  return resource?.resourceId ?? null;
}

export async function getSelectedGA4Property(db: SupabaseClient, userId: string, projectId: string): Promise<{ id: string; name: string } | null> {
  const integration = await getProjectIntegration(db, userId, projectId, "google-analytics");
  if (!integration) return null;
  const resource = await getSelectedIntegrationResource(db, userId, integration.id, "ga4_property");
  return resource ? { id: resource.resourceId, name: resource.resourceName } : null;
}

/** Other projects' connections of this type, most recently updated first (used to reuse a Google account). */
export async function listSiblingIntegrations(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  integrationType: IntegrationType
): Promise<ProjectIntegration[]> {
  const { data } = await db
    .from("integration_connections")
    .select("id, project_id, provider, external_email, created_at, updated_at")
    .eq("user_id", userId)
    .eq("provider", providerFor(integrationType))
    .not("project_id", "is", null)
    .neq("project_id", projectId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((row) => mapIntegration(row as ConnectionRow));
}

export type ResourceUsage = { resourceId: string; projectId: string; projectName: string };

/** Which other projects have already selected which Google resources. */
export async function listResourceUsage(db: SupabaseClient, userId: string, excludeProjectId: string): Promise<ResourceUsage[]> {
  const { data: selected } = await db
    .from("integration_resources")
    .select("resource_id, connection_id")
    .eq("user_id", userId)
    .eq("selected", true);
  if (!selected?.length) return [];

  const { data: connections } = await db
    .from("integration_connections")
    .select("id, project_id")
    .eq("user_id", userId)
    .in("id", [...new Set(selected.map((r) => r.connection_id as string))])
    .neq("project_id", excludeProjectId);
  const projectByConnection = new Map((connections ?? []).map((c) => [c.id as string, c.project_id as string]));
  const projectIds = [...new Set(projectByConnection.values())];
  if (projectIds.length === 0) return [];

  const { data: projects } = await db.from("projects").select("id, name").eq("owner_id", userId).in("id", projectIds);
  const nameById = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));

  return selected.flatMap((r) => {
    const projectId = projectByConnection.get(r.connection_id as string);
    return projectId ? [{ resourceId: r.resource_id as string, projectId, projectName: nameById.get(projectId) ?? "another project" }] : [];
  });
}
