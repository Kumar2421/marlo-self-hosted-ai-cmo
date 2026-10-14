/** Real Google Cloud API Keys API (apikeys.googleapis.com) — raw fetch, no
 * SDK. Key creation is a long-running operation (Google's pattern for most
 * Cloud resource-create calls): POST returns an Operation, poll it until
 * done, then the Key resource is in the operation's response — but the
 * secret itself (`keyString`) is only ever returned by a separate
 * keys.getKeyString call, never by create/get. Contracts verified against
 * real GCP docs before writing this. */

const API_BASE = "https://apikeys.googleapis.com/v2";
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20; // ~40s — key creation is normally a few seconds

/** The three real services this app's Google Cloud features call — see
 * local/placesSearch.ts, googleSearch.ts, knowledgeGraph.ts for the exact
 * endpoints this key needs to be allowed against. */
const API_TARGETS = [{ service: "places.googleapis.com" }, { service: "customsearch.googleapis.com" }, { service: "kgsearch.googleapis.com" }];

async function pollOperation(accessToken: string, operationName: string): Promise<{ name: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const res = await fetch(`${API_BASE}/${operationName}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Checking key creation status failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
    }
    const op = await res.json();
    if (op.error) {
      throw new Error(`Key creation failed: ${op.error.message ?? JSON.stringify(op.error)}`);
    }
    if (op.done) {
      return op.response;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Key creation is taking longer than expected — check the Google Cloud Console for this project directly.");
}

/**
 * Creates a real API key on the given GCP project, restricted to exactly
 * the three services this app needs (Places, Custom Search, Knowledge
 * Graph) — never an unrestricted key. Returns the real secret string.
 */
export async function createRestrictedApiKey(accessToken: string, gcpProjectId: string, displayName: string): Promise<string> {
  const createRes = await fetch(`${API_BASE}/projects/${gcpProjectId}/locations/global/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, restrictions: { apiTargets: API_TARGETS } }),
  });

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    if (createRes.status === 403) {
      throw new Error(`No permission to create API keys on project "${gcpProjectId}" — check the project id and that this Google account has the API Keys Admin role on it.`);
    }
    if (createRes.status === 404) {
      throw new Error(`Project "${gcpProjectId}" not found, or the API Keys API isn't enabled on it.`);
    }
    throw new Error(`Key creation request failed: HTTP ${createRes.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  const operation = await createRes.json();
  const key = await pollOperation(accessToken, operation.name);

  const stringRes = await fetch(`${API_BASE}/${key.name}/keyString`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!stringRes.ok) {
    throw new Error(`Key was created but couldn't retrieve its value: HTTP ${stringRes.status}. Check it in Google Cloud Console.`);
  }
  const { keyString } = await stringRes.json();
  return keyString;
}
