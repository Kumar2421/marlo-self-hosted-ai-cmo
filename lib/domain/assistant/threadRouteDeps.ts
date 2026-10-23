import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import type { TurnContext } from "./assistantTypes";
import { createPlatformPorts } from "./platformAdapters";
import { createSelfHostPorts } from "./selfHostAdapters";
import type { RouteResult, ThreadRouteDeps } from "./threadRoutes";

/** Real ports for the thread routes (the chat route's own wiring). Imported only by the route files. */
export function threadDeps(): ThreadRouteDeps {
  const platform = FEATURES.PLATFORM_MODE;
  const ports = platform ? createPlatformPorts() : createSelfHostPorts();
  const ctx: TurnContext = { mode: platform ? "platform" : "selfhost", userId: null, activeProjectId: null };
  return { scope: ports.scope, threads: ports.threads, ctx };
}

export const reply = (r: RouteResult) => NextResponse.json(r.body, { status: r.status });
