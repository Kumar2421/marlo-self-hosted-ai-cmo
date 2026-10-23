"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";

export type UsageEvent = {
  id: string;
  agent_type: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  credits_charged: number;
  status: "ok" | "failed" | "refunded";
  created_at: string;
};

export type CreditCost = { agent_type: string; credits: number; description: string | null };

export type UsageData = {
  available: boolean;
  balance?: number;
  granted?: number;
  planTier?: string;
  billingEnabled?: boolean;
  events?: UsageEvent[];
  costs?: CreditCost[];
};

export const fetchUsage = () => fetchJson<UsageData>("/api/usage");

/**
 * Settings > Credits data. Cached for 30s (app default) so revisiting shows it instantly;
 * past that the cached numbers stay on screen while a background refetch replaces them,
 * and window focus refetches too.
 */
export function useUsage() {
  return useQuery({ queryKey: qk.usage(), queryFn: fetchUsage });
}
