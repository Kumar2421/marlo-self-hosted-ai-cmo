import { googleReconnectHref } from "@/lib/domain/integrations/googleHealthView";

/** "Reconnect Google" through the existing connect route (platform and self-host). */
export default function GoogleReconnectLink({ returnTo, className }: { returnTo: "settings" | "dashboard"; className?: string }) {
  return (
    <a
      href={googleReconnectHref(returnTo)}
      className={className ?? "inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"}
    >
      Reconnect Google
    </a>
  );
}
