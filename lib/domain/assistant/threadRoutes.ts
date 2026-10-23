import { checkChatProjectScope } from "../chat/projectScope.ts";
import type { ScopePort } from "./assistantService.ts";
import type { TurnContext } from "./assistantTypes.ts";
import { ThreadsUnavailableError, type ThreadScope, type ThreadStore } from "./threadStore.ts";

/** Framework-free handlers for /api/chat/threads. The Next route files only parse the request and call these. */
export type ThreadRouteDeps = { scope: ScopePort; threads: ThreadStore | undefined; ctx: TurnContext };
export type RouteResult = { status: number; body: unknown };

const NOT_FOUND: RouteResult = { status: 404, body: { error: "Chat not found." } };
const UNAVAILABLE: RouteResult = { status: 503, body: { error: "Chat history isn't available yet.", unavailable: true } };

type Resolved = { ok: true; scope: ThreadScope; store: ThreadStore } | { ok: false; result: RouteResult; noProject?: boolean };

async function resolve(deps: ThreadRouteDeps, requestedProjectId: unknown): Promise<Resolved> {
  const session = await deps.scope.authenticate(deps.ctx);
  if (!session) return { ok: false, result: { status: 401, body: { error: "Not authenticated" } } };
  if (!deps.threads) return { ok: false, result: UNAVAILABLE };
  const ctx = { ...deps.ctx, userId: session.userId };
  const active = await deps.scope.activeProjectId(ctx);
  const check = checkChatProjectScope(requestedProjectId, active);
  if (!check.ok) return { ok: false, result: { status: 409, body: { error: check.error } } };
  if (!active) return { ok: false, result: { status: 200, body: { available: true, threads: [] } }, noProject: true };
  return { ok: true, scope: { userId: session.userId, projectId: active }, store: deps.threads };
}

/** Maps the store's "tables missing" signal to 503; anything else is a real error and propagates. */
async function guarded(fn: () => Promise<RouteResult>): Promise<RouteResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ThreadsUnavailableError) return UNAVAILABLE;
    throw err;
  }
}

export async function listThreadsRoute(deps: ThreadRouteDeps, projectId: unknown): Promise<RouteResult> {
  const r = await resolve(deps, projectId);
  if (!r.ok) return r.result;
  return guarded(async () => ({ status: 200, body: { available: true, threads: await r.store.listThreads(r.scope) } }));
}

/** Lets the client probe quickly: unavailable is a normal 200 answer for the list, so the UI can hide History. */
export async function listThreadsOrUnavailable(deps: ThreadRouteDeps, projectId: unknown): Promise<RouteResult> {
  const res = await listThreadsRoute(deps, projectId);
  const unavailable = res.status === 503 && (res.body as { unavailable?: boolean }).unavailable;
  return unavailable ? { status: 200, body: { available: false, threads: [] } } : res;
}

export async function createThreadRoute(deps: ThreadRouteDeps, body: unknown): Promise<RouteResult> {
  const b = (body ?? {}) as { title?: unknown; projectId?: unknown };
  const r = await resolve(deps, b.projectId);
  if (!r.ok) return r.noProject ? { status: 409, body: { error: "No active project." } } : r.result;
  return guarded(async () => ({ status: 201, body: { thread: await r.store.createThread(r.scope, typeof b.title === "string" ? b.title : "") } }));
}

export async function getThreadRoute(deps: ThreadRouteDeps, id: string, projectId: unknown): Promise<RouteResult> {
  const r = await resolve(deps, projectId);
  if (!r.ok) return r.noProject ? NOT_FOUND : r.result;
  return guarded(async () => {
    const found = await r.store.getThread(r.scope, id);
    return found ? { status: 200, body: found } : NOT_FOUND;
  });
}

export async function renameThreadRoute(deps: ThreadRouteDeps, id: string, body: unknown): Promise<RouteResult> {
  const b = (body ?? {}) as { title?: unknown; projectId?: unknown };
  if (typeof b.title !== "string" || !b.title.trim()) return { status: 400, body: { error: "title is required" } };
  const r = await resolve(deps, b.projectId);
  if (!r.ok) return r.noProject ? NOT_FOUND : r.result;
  return guarded(async () => ((await r.store.renameThread(r.scope, id, b.title as string)) ? { status: 200, body: { ok: true } } : NOT_FOUND));
}

export async function deleteThreadRoute(deps: ThreadRouteDeps, id: string, projectId: unknown): Promise<RouteResult> {
  const r = await resolve(deps, projectId);
  if (!r.ok) return r.noProject ? NOT_FOUND : r.result;
  return guarded(async () => ((await r.store.deleteThread(r.scope, id)) ? { status: 200, body: { ok: true } } : NOT_FOUND));
}

/** Deletes every chat of the active project. Needs an explicit {confirm:true} body. */
export async function deleteAllThreadsRoute(deps: ThreadRouteDeps, body: unknown): Promise<RouteResult> {
  const b = (body ?? {}) as { confirm?: unknown; projectId?: unknown };
  if (b.confirm !== true) return { status: 400, body: { error: "Send {\"confirm\": true} to delete all chats." } };
  const r = await resolve(deps, b.projectId);
  if (!r.ok) return r.noProject ? { status: 200, body: { ok: true, deleted: 0 } } : r.result;
  return guarded(async () => ({ status: 200, body: { ok: true, deleted: await r.store.deleteAllThreads(r.scope) } }));
}
