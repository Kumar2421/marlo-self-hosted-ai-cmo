import { NextRequest } from "next/server";
import { deleteThreadRoute, getThreadRoute, renameThreadRoute } from "@/lib/domain/assistant/threadRoutes";
import { reply, threadDeps } from "@/lib/domain/assistant/threadRouteDeps";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return reply(await getThreadRoute(threadDeps(), id, req.nextUrl.searchParams.get("projectId")));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return reply(await renameThreadRoute(threadDeps(), id, await req.json().catch(() => null)));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return reply(await deleteThreadRoute(threadDeps(), id, req.nextUrl.searchParams.get("projectId")));
}
