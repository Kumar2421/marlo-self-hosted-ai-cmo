// Pure helpers for the Marlo MCP server: build the request, call the public audit API, format the answer.
// No MCP SDK in here, so node:test covers it with a fake fetch.

export const DEFAULT_BASE_URL = "https://app.marlo.mlforge.in";
export const REQUEST_TIMEOUT_MS = 75_000;
export const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 256 * 1024;

/** Returns a normalised http(s) URL string, or throws an Error with a message safe to show the user. */
export function parseTargetUrl(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new Error("Give a website address, for example https://example.com.");
  if (text.length > MAX_URL_LENGTH) throw new Error("That address is too long.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a website address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses can be audited.");
  return url.toString();
}

/** Reads MARLO_BASE_URL and MARLO_ACCESS_PASSWORD. The password is only ever sent to an explicit base URL. */
export function resolveConfig(env) {
  const custom = (env.MARLO_BASE_URL ?? "").trim();
  let baseUrl = DEFAULT_BASE_URL;
  if (custom) {
    let parsed;
    try {
      parsed = new URL(custom);
    } catch {
      throw new Error("MARLO_BASE_URL is not a valid URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MARLO_BASE_URL must start with http:// or https://.");
    baseUrl = parsed.origin;
  }
  const password = custom ? (env.MARLO_ACCESS_PASSWORD ?? "") : "";
  return { baseUrl, password };
}

async function readCapped(res) {
  const text = await res.text();
  return text.length > MAX_RESPONSE_BYTES ? text.slice(0, MAX_RESPONSE_BYTES) : text;
}

/** Calls POST {base}/api/public/audit. Resolves to the parsed JSON, or throws an Error with a user-safe message. */
export async function runAudit(targetUrl, { baseUrl, password }, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const headers = { "Content-Type": "application/json", "User-Agent": "marlo-mcp/0.1.0", Accept: "application/json" };
  if (password) headers.Authorization = `Basic ${Buffer.from(`marlo:${password}`).toString("base64")}`;

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/public/audit`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("The audit took too long. Try again, or try a lighter page.");
    throw new Error(`Could not reach Marlo at ${baseUrl}. Check your connection and MARLO_BASE_URL.`);
  }

  let body = null;
  try {
    body = JSON.parse(await readCapped(res));
  } catch {
    body = null;
  }

  if (res.status === 401) throw new Error("Marlo asked for a password. Set MARLO_ACCESS_PASSWORD for your own server.");
  if (res.status === 429) {
    const wait = Number.parseInt(res.headers?.get?.("retry-after") ?? "", 10);
    throw new Error(`Marlo is rate limiting audits right now. ${Number.isFinite(wait) && wait > 0 ? `Try again in about ${wait} seconds.` : "Try again in a minute."}`);
  }
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Marlo answered with HTTP ${res.status}.`;
    throw new Error(message);
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.findings)) throw new Error("Marlo returned an answer this version does not understand.");
  return body;
}

function evidenceLine(evidence) {
  if (!evidence || typeof evidence !== "object") return "";
  return Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 160)}`)
    .join("; ");
}

/** Plain-text answer for the model and the person reading it. Only states what the API returned. */
export function formatAudit(result) {
  const summary = result.summary ?? {};
  const total = Number.isFinite(summary.totalFindings) ? summary.totalFindings : result.findings.length;
  const lines = [];
  const score = Number.isFinite(result.technical?.onPageScore) ? `, on-page score ${result.technical.onPageScore}/100` : "";
  const status = Number.isFinite(result.technical?.status) ? `HTTP ${result.technical.status}` : "HTTP status unknown";
  lines.push(`Marlo audit of ${result.url} (${status}${score})`);

  if (total === 0 || result.findings.length === 0) {
    lines.push("No issues found by the on-page checks. This covers one page, not the whole site.");
    return lines.join("\n");
  }
  lines.push(`${total} issue${total === 1 ? "" : "s"} found (${summary.critical ?? 0} errors, ${summary.warnings ?? 0} warnings). Showing the top ${result.findings.length}:`);
  result.findings.forEach((finding, index) => {
    lines.push("");
    lines.push(`${index + 1}. [${finding.severity}] ${finding.label} (${finding.category})`);
    const evidence = evidenceLine(finding.evidence);
    if (evidence) lines.push(`   Evidence: ${evidence}`);
    if (finding.whyItMatters) lines.push(`   Why it matters: ${finding.whyItMatters}`);
    if (finding.recommendation) lines.push(`   Fix: ${finding.recommendation}`);
    if (finding.autoFixable) lines.push("   Marlo marks this one as auto-fixable.");
  });
  lines.push("");
  lines.push("Audited one page only. Full audits, tracking and draft fix PRs: https://github.com/Kumar2421/okara-alternative");
  return lines.join("\n");
}
