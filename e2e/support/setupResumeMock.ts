import type { Page, Route } from "@playwright/test";
import {
  SETUP_STEPS,
  isSetupStepKey,
  isSetupStatus,
  newSetupState,
  summarizeSetup,
  type SetupFacts,
  type SetupState,
  type SetupStatus,
  type SetupStepKey,
} from "../../lib/domain/project/setupState.ts";
import { getOrCreateSetupState, recordSetupTransition, startSetupState, type SetupStateStore } from "../../lib/domain/project/setupStateService.ts";

/**
 * Stateful stand-in for every backend call the project-setup flow makes, so the resume tests run
 * with no provider, LLM, crawler or database. The /api/project/setup route is backed by the REAL
 * setup service (the same getOrCreate / recordSetupTransition the Next route calls) over an
 * in-memory store, so transition rules, the stale-running cutoff and 409 conflicts behave as in
 * production. Must be installed AFTER mockDashboardApi (later page.route handlers win; anything
 * not handled here falls back to it).
 */

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOC_KEYS = ["product-info", "marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"] as const;
const LONG_DOC = `# Document\n\n${"This is a complete generated paragraph about the product and its market. ".repeat(6)}\n\nDone.`;

export const COMPLETE_FACTS: SetupFacts = { hasAudit: true, hasDescription: true, hasCompetitors: true, documents: [...DOC_KEYS] };

/** Builds a state from per-step statuses (default: pending). Step times are `ageMs` before now. */
export function stateOf(
  statuses: Partial<Record<SetupStepKey, SetupStatus | { status: SetupStatus; ageMs?: number; error?: string }>>,
  opts: { started?: boolean } = {},
): SetupState {
  const now = Date.now();
  const s = newSetupState(new Date(now), opts.started ?? true);
  for (const k of SETUP_STEPS) {
    const v = statuses[k];
    if (!v) continue;
    const o = typeof v === "string" ? { status: v } : v;
    s.steps[k] = { status: o.status, at: new Date(now - (o.ageMs ?? 60_000)).toISOString(), ...(o.error ? { error: o.error } : {}) };
  }
  return s;
}

export const ALL_DONE: Partial<Record<SetupStepKey, SetupStatus>> = Object.fromEntries(SETUP_STEPS.map((k) => [k, "done"]));

export type SetupMockOptions = {
  /** Project that exists before the page loads; null shows the onboarding modal. */
  project: boolean;
  /** Stored setup row; null = no row (legacy project, or a fresh account). */
  state?: SetupState | null;
  /** What the lazy derive sees when there is no row. */
  facts?: SetupFacts;
  /** GET and PUT /api/project/setup answer 500 (table missing). */
  setupBroken?: boolean;
};

export type SetupMock = Awaited<ReturnType<typeof mockSetupApi>>;

export async function mockSetupApi(page: Page, opts: SetupMockOptions) {
  let hasProject = opts.project;
  let stored: SetupState | null = opts.state ?? null;
  const facts = opts.facts ?? { hasAudit: false, hasDescription: false, hasCompetitors: false, documents: [] };
  /** "METHOD /path" for every call the app made, in order. */
  const calls: string[] = [];
  const puts: { step: SetupStepKey; status: SetupStatus }[] = [];
  /** Step routes that answer 500 until deleted from this set. */
  const failing = new Set<string>();
  /** Added to the competitors list the app sees. */
  let competitors = [{ id: "c1", url: "https://rival.example.test" }];

  const store: SetupStateStore = {
    load: async () => stored,
    saveIfUnchanged: async (next, expected) => {
      if (expected === null ? stored !== null : stored?.updatedAt !== expected) return false;
      stored = next;
      return true;
    },
    facts: async () => facts,
  };

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const project = () => ({
    id: PROJECT_ID,
    name: "Acme",
    category: "SaaS",
    description: "",
    url: "https://acme.example.test",
    updated_at: "2026-01-01T00:00:00Z",
  });

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    const record = () => calls.push(`${method} ${path}`);

    if (path === "/api/providers" && method === "GET") {
      return json(route, { connections: [{ providerId: "openai", keyPreview: "sk-…test" }], primaryModel: "gpt-5", platformProviders: [] });
    }

    if (path === "/api/project" && method === "GET") {
      return json(route, hasProject ? { project: project(), projects: [project()] } : { project: null, projects: [] });
    }
    if (path === "/api/project" && method === "POST") {
      record();
      hasProject = true;
      stored = null;
      await startSetupState(store); // what the real POST /api/project does
      return json(route, { project: project() });
    }
    if (path === "/api/project/data" && !hasProject) return json(route, { error: "No active project" }, 404);

    if (path === "/api/project/setup") {
      record();
      if (opts.setupBroken) return json(route, { error: 'relation "project_setup_state" does not exist' }, 500);
      const now = new Date();
      if (method === "GET") {
        const state = await getOrCreateSetupState(store, now);
        return json(route, { state, summary: summarizeSetup(state, now), serverTime: now.toISOString() });
      }
      if (method === "PUT") {
        const body = JSON.parse(req.postData() ?? "{}");
        if (!isSetupStepKey(body.step) || !isSetupStatus(body.status)) return json(route, { error: "bad request" }, 400);
        puts.push({ step: body.step, status: body.status });
        const out = await recordSetupTransition(store, { step: body.step, status: body.status, error: body.error, retry: body.retry === true }, now);
        if (!out.ok) return json(route, { error: out.message, reason: out.reason }, out.reason === "invalid" ? 400 : 409);
        return json(route, { state: out.state, summary: summarizeSetup(out.state, now), serverTime: now.toISOString() });
      }
    }

    // ---- the work the steps ask for (all fake) ----
    const step = (key: string, ok: () => Promise<void> | void) => {
      record();
      if (failing.has(key)) return json(route, { error: `${key} exploded` }, 500);
      return Promise.resolve(ok());
    };
    if (path === "/api/agents/seo/audit" && method === "POST") return step("audit", () => json(route, { meta: { title: "Acme Invoice" } }));
    if (path === `/api/project/${PROJECT_ID}/generate-description` && method === "POST") {
      return step("description", () => json(route, { description: "Invoicing for freelancers." }));
    }
    if (path === "/api/project/competitors/discover" && method === "POST") {
      return step("competitors", () => json(route, { added: [{ url: "https://rival.example.test" }], usedWebSearch: true }));
    }
    if (path === `/api/project/${PROJECT_ID}/generate-leads` && method === "POST") return step("leads", () => json(route, { added: 3 }));
    if (path === "/api/project/competitors" && method === "GET") return json(route, { competitors });
    const doc = /^\/api\/project\/documents\/([a-z-]+)(\/save)?$/.exec(path);
    if (doc && method === "POST" && (DOC_KEYS as readonly string[]).includes(doc[1])) {
      const key = doc[1];
      if (doc[2]) {
        record();
        return json(route, { ok: true });
      }
      return step(key, () =>
        key === "competitor-comparison"
          ? route.fulfill({ status: 200, contentType: "text/plain", body: "saved" })
          : route.fulfill({ status: 200, contentType: "text/plain", body: LONG_DOC }),
      );
    }

    return route.fallback();
  });

  return {
    calls,
    puts,
    failing,
    /** How many times the app called `METHOD /path`. */
    count: (call: string) => calls.filter((c) => c === call).length,
    /** The persisted row as the server holds it (null = none). */
    state: () => stored,
    /** Another tab changing the row. */
    setState: (next: SetupState) => {
      stored = next;
    },
    setCompetitors: (list: { id: string; url: string }[]) => {
      competitors = list;
    },
  };
}

/** Request path for a step: where the app POSTs to run it. */
export const STEP_CALL: Record<SetupStepKey, string> = {
  audit: "POST /api/agents/seo/audit",
  description: `POST /api/project/${PROJECT_ID}/generate-description`,
  competitors: "POST /api/project/competitors/discover",
  leads: `POST /api/project/${PROJECT_ID}/generate-leads`,
  "product-info": "POST /api/project/documents/product-info",
  "marketing-strategy": "POST /api/project/documents/marketing-strategy",
  "competitor-analysis": "POST /api/project/documents/competitor-analysis",
  "competitor-comparison": "POST /api/project/documents/competitor-comparison",
  "content-strategy": "POST /api/project/documents/content-strategy",
  "design-guide": "POST /api/project/documents/design-guide",
};
