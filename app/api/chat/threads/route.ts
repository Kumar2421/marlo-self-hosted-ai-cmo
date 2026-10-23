import { NextRequest } from "next/server";
import { createThreadRoute, deleteAllThreadsRoute, listThreadsOrUnavailable } from "@/lib/domain/assistant/threadRoutes";
import { reply, threadDeps } from "@/lib/domain/assistant/threadRouteDeps";

/** GET: this project's chats, newest first. POST: create an empty chat. DELETE {confirm:true}: delete all of them. */
export async function GET(req: NextRequest) {
  return reply(await listThreadsOrUnavailable(threadDeps(), req.nextUrl.searchParams.get("projectId")));
}

export async function POST(req: NextRequest) {
  return reply(await createThreadRoute(threadDeps(), await req.json().catch(() => null)));
}

export async function DELETE(req: NextRequest) {
  return reply(await deleteAllThreadsRoute(threadDeps(), await req.json().catch(() => null)));
}
