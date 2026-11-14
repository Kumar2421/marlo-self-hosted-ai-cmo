import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getDb } from "@/lib/db";
import type { PublicReportStore } from "./publicReport.ts";
import { sqliteReportStore, supabaseReportStore, type ReportsClient } from "./publicReportStores.ts";

/** Hosted uses the shared Supabase table through the service role; self-host uses the local SQLite file. */
export function publicReportStore(): PublicReportStore {
  if (FEATURES.PLATFORM_MODE) return supabaseReportStore(createServiceClient() as unknown as ReportsClient);
  return sqliteReportStore(getDb());
}
