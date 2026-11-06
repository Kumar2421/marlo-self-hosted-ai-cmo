import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeOfferModel, type OfferModel } from "./offerModel.ts";
import { OFFER_MODEL_DOC } from "./offerModelStore.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getOfferModel(db: SupabaseClient, userId: string, projectId: string): Promise<OfferModel | null> {
  const { data } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", OFFER_MODEL_DOC)
    .maybeSingle();
  if (!data?.content) return null;
  try {
    return normalizeOfferModel(JSON.parse(data.content as string));
  } catch {
    return null;
  }
}

export async function saveOfferModel(db: SupabaseClient, userId: string, projectId: string, offer: OfferModel, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const { data: existing } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", OFFER_MODEL_DOC)
    .maybeSingle();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: OFFER_MODEL_DOC,
      status: "ready",
      content: JSON.stringify(offer),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}
