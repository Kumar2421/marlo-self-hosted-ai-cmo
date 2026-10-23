"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { chatMeterView } from "@/lib/domain/chat/chatMeter";
import type { ChatAllowance } from "@/lib/domain/assistant/chatEntitlements";

/** "N of 10 chats left this month": only for the free plan while plan enforcement is on; amber at 3 or fewer. */
export default function ChatUsageMeter() {
  const { data } = useQuery({
    queryKey: qk.chatAllowance(),
    queryFn: () => fetchJson<ChatAllowance>("/api/chat/allowance"),
    staleTime: 30_000,
    retry: false,
  });
  const view = chatMeterView(data);
  if (!view) return null;
  return (
    <p data-testid="chat-usage-meter" className={`mt-2 px-1 text-xs ${view.amber ? "text-amber-600" : "text-ui-subtle"}`}>
      {view.text}
    </p>
  );
}
