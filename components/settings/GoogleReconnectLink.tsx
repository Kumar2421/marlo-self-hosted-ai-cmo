import { googleReconnectHref } from "@/lib/domain/integrations/googleHealthView";

/** "Reconnect Google" through the existing connect route (platform and self-host). */
export default function GoogleReconnectLink({ returnTo, className }: { returnTo: "settings" | "dashboard"; className?: string }) {
  return (
    <a
      href={googleReconnectHref(returnTo)}
      className={className ?? "inline-flex items-center gap-1.5 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[12px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover"}
    >
      Reconnect Google
    </a>
  );
}
