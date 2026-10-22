import { getDb } from "@/lib/db";
import crypto from "node:crypto";
import type {
  IntegrationResource,
  IntegrationSecrets,
  IntegrationType,
  ProjectIntegration,
} from "./integrationTypes";
import { chooseSelectedResourceId } from "./resourceSelection.ts";

type IntegrationRow = {
  id: string;
  project_id: string;
  provider: string;
  integration_type: IntegrationType;
  status: ProjectIntegration["status"];
  account_identifier: string | null;
  connected_at: string;
  updated_at: string;
};

function mapIntegration(row: IntegrationRow): ProjectIntegration {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    integrationType: row.integration_type,
    status: row.status,
    accountIdentifier: row.account_identifier,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

export function getProjectIntegration(
  projectId: string,
  integrationType: IntegrationType
): ProjectIntegration | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM project_integrations WHERE project_id = ? AND integration_type = ?"
    )
    .get(projectId, integrationType) as IntegrationRow | undefined;
  return row ? mapIntegration(row) : null;
}

export function listProjectIntegrations(projectId: string): ProjectIntegration[] {
  const rows = getDb()
    .prepare("SELECT * FROM project_integrations WHERE project_id = ? ORDER BY provider, integration_type")
    .all(projectId) as IntegrationRow[];
  return rows.map(mapIntegration);
}

export function upsertProjectIntegration(input: {
  projectId: string;
  provider: string;
  integrationType: IntegrationType;
  status?: ProjectIntegration["status"];
  accountIdentifier?: string | null;
  connectedAt?: string;
}): ProjectIntegration {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getProjectIntegration(input.projectId, input.integrationType);
  const id = existing?.id ?? `int_${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO project_integrations
      (id, project_id, provider, integration_type, status, account_identifier, connected_at, updated_at)
    VALUES (@id, @projectId, @provider, @integrationType, @status, @accountIdentifier, @connectedAt, @updatedAt)
    ON CONFLICT(project_id, integration_type) DO UPDATE SET
      provider = excluded.provider,
      status = excluded.status,
      account_identifier = excluded.account_identifier,
      updated_at = excluded.updated_at
  `).run({
    id,
    projectId: input.projectId,
    provider: input.provider,
    integrationType: input.integrationType,
    status: input.status ?? "connected",
    accountIdentifier: input.accountIdentifier ?? null,
    connectedAt: existing?.connectedAt ?? input.connectedAt ?? now,
    updatedAt: now,
  });

  return getProjectIntegration(input.projectId, input.integrationType)!;
}

export function saveIntegrationSecrets(integrationId: string, secrets: IntegrationSecrets): void {
  getDb().prepare(`
    INSERT INTO integration_secrets (integration_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(integration_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(integrationId, secrets.accessToken, secrets.refreshToken, secrets.expiresAt, new Date().toISOString());
}

export function getIntegrationSecrets(integrationId: string): IntegrationSecrets | null {
  const row = getDb()
    .prepare("SELECT access_token, refresh_token, expires_at FROM integration_secrets WHERE integration_id = ?")
    .get(integrationId) as
    | { access_token: string; refresh_token: string; expires_at: number }
    | undefined;
  return row
    ? { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at }
    : null;
}

export function replaceIntegrationResources(
  integrationId: string,
  resources: Omit<IntegrationResource, "id" | "integrationId" | "selected">[],
  selectedResourceId?: string | null
): IntegrationResource[] {
  const db = getDb();
  const previous = db
    .prepare("SELECT resource_id FROM integration_resources WHERE integration_id = ? AND selected = 1 LIMIT 1")
    .get(integrationId) as { resource_id: string } | undefined;
  const keepId = chooseSelectedResourceId(
    resources.map((resource) => resource.resourceId),
    previous?.resource_id ?? null,
    selectedResourceId,
  );
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM integration_resources WHERE integration_id = ?").run(integrationId);
    const insert = db.prepare(`
      INSERT INTO integration_resources
        (id, integration_id, resource_type, resource_id, resource_name, metadata, selected)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    resources.forEach((resource, index) => {
      const id = `res_${crypto.randomUUID()}`;
      insert.run(
        id,
        integrationId,
        resource.resourceType,
        resource.resourceId,
        resource.resourceName,
        JSON.stringify(resource.metadata ?? {}),
        keepId !== null && resource.resourceId === keepId
      );
    });
  });
  transaction();

  return listIntegrationResources(integrationId);
}

export function listIntegrationResources(integrationId: string): IntegrationResource[] {
  const rows = getDb()
    .prepare("SELECT * FROM integration_resources WHERE integration_id = ? ORDER BY resource_name")
    .all(integrationId) as {
    id: string;
    integration_id: string;
    resource_type: string;
    resource_id: string;
    resource_name: string;
    metadata: string;
    selected: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    integrationId: row.integration_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    selected: row.selected === 1,
  }));
}

export function selectIntegrationResource(integrationId: string, resourceId: string): boolean {
  const db = getDb();
  const resource = db
    .prepare("SELECT id FROM integration_resources WHERE integration_id = ? AND resource_id = ?")
    .get(integrationId, resourceId);
  if (!resource) return false;

  const transaction = db.transaction(() => {
    db.prepare("UPDATE integration_resources SET selected = 0 WHERE integration_id = ?").run(integrationId);
    db.prepare("UPDATE integration_resources SET selected = 1 WHERE integration_id = ? AND resource_id = ?").run(
      integrationId,
      resourceId
    );
    db.prepare("UPDATE project_integrations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), integrationId);
  });
  transaction();
  return true;
}

export function getSelectedIntegrationResource(
  integrationId: string,
  resourceType: string
): IntegrationResource | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM integration_resources WHERE integration_id = ? AND resource_type = ? AND selected = 1 LIMIT 1"
    )
    .get(integrationId, resourceType) as
    | {
        id: string;
        integration_id: string;
        resource_type: string;
        resource_id: string;
        resource_name: string;
        metadata: string;
        selected: number;
      }
    | undefined;

  return row
    ? {
        id: row.id,
        integrationId: row.integration_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        resourceName: row.resource_name,
        metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
        selected: true,
      }
    : null;
}

export function deleteProjectIntegration(projectId: string, integrationType: IntegrationType): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    const rows = db
      .prepare("SELECT id FROM project_integrations WHERE project_id = ? AND integration_type = ?")
      .all(projectId, integrationType) as { id: string }[];
    for (const row of rows) {
      db.prepare("DELETE FROM integration_secrets WHERE integration_id = ?").run(row.id);
      db.prepare("DELETE FROM integration_resources WHERE integration_id = ?").run(row.id);
      db.prepare("DELETE FROM project_integrations WHERE id = ?").run(row.id);
    }
  });
  transaction();
}

/** Other projects' connections of this type, most recently updated first (used to reuse a Google account). */
export function listSiblingIntegrations(projectId: string, integrationType: IntegrationType): ProjectIntegration[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM project_integrations WHERE integration_type = ? AND project_id != ? ORDER BY updated_at DESC"
    )
    .all(integrationType, projectId) as IntegrationRow[];
  return rows.map(mapIntegration);
}

export type ResourceUsage = { resourceId: string; projectId: string; projectName: string };

/** Which other projects have already selected which Google resources. */
export function listResourceUsage(excludeProjectId: string): ResourceUsage[] {
  return getDb()
    .prepare(
      `SELECT r.resource_id AS resourceId, i.project_id AS projectId, p.name AS projectName
       FROM integration_resources r
       JOIN project_integrations i ON i.id = r.integration_id
       JOIN projects p ON p.id = i.project_id
       WHERE r.selected = 1 AND i.project_id != ?`
    )
    .all(excludeProjectId) as ResourceUsage[];
}
