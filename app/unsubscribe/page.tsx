import { checkUnsubscribeToken } from "@/lib/domain/leads/outreachUnsubscribe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// Public, no login. Rendering this page changes nothing (mail scanners open links); only the button below does,
// by POSTing the signed token to the unsubscribe endpoint.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const valid = checkUnsubscribeToken(token, process.env.NOTIFY_SIGNING_SECRET);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px", fontFamily: "-apple-system, Segoe UI, Helvetica, Arial, sans-serif", color: "#111827" }}>
      {valid && token ? (
        <>
          <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Unsubscribe from these emails?</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>You will not receive further emails from this sender.</p>
          <form method="post" action={`/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`}>
            <button type="submit" style={{ fontSize: 14, padding: "10px 18px", borderRadius: 8, border: 0, background: "#111111", color: "#ffffff", cursor: "pointer" }}>
              Unsubscribe
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>This link isn&apos;t valid</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>It may have expired or been copied incorrectly.</p>
        </>
      )}
    </main>
  );
}
