"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import type { DailyDraftSettings } from "@/lib/domain/social/dailyDraftSettings";
import type { PlatformId } from "@/lib/domain/social/platforms";

const ENDPOINT = "/api/agents/social/daily-settings";
const JSON_HEADERS = { "Content-Type": "application/json" };

const NETWORKS: Array<{ id: PlatformId; name: string }> = [
  { id: "x", name: "X" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "reddit", name: "Reddit" },
];

/** The project's daily draft switches. Saves are optimistic and roll back when the server refuses. */
export function useDailyDraftSettings() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const key = qk.socialDailySettings(project?.id);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await fetchJson<{ settings: DailyDraftSettings }>(ENDPOINT)).settings,
    enabled: Boolean(project),
  });

  const save = useMutation({
    mutationFn: (settings: DailyDraftSettings) =>
      fetchJson<{ settings: DailyDraftSettings }>(ENDPOINT, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ settings }) }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DailyDraftSettings>(key);
      queryClient.setQueryData<DailyDraftSettings>(key, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData<DailyDraftSettings>(key, context?.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DailyDraftSettings>(key, data.settings);
    },
  });

  return { query, save };
}

/** Compact "Daily drafts" section: one switch per network, on by default. */
export default function SocialNavMenu() {
  const { query, save } = useDailyDraftSettings();
  const settings = query.data;

  return (
    <section aria-label="Daily drafts" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <h4 className="text-[13px] font-semibold text-gray-900">Daily drafts</h4>
        <p className="text-[11px] text-gray-500">One draft per network each day, for review. Nothing is posted.</p>
      </div>

      {query.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-800">
          <span>Could not load daily draft settings.</span>
          <button type="button" onClick={() => query.refetch()} className="font-medium underline hover:no-underline">
            Retry
          </button>
        </div>
      ) : !settings ? (
        <div className="h-16 animate-pulse rounded-lg bg-gray-50" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {NETWORKS.map((network) => {
            const on = settings[network.id];
            return (
              <li key={network.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[12px] font-medium text-gray-800">{network.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">Auto-draft daily</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Auto-draft daily on ${network.name}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ ...settings, [network.id]: !on })}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-[#00ab92]" : "bg-gray-300"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {save.isError && <p className="mt-2 text-[11px] text-amber-700">Could not save. The switch was set back.</p>}
    </section>
  );
}
