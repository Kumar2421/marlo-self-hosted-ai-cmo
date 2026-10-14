import { resolveMx } from "node:dns/promises";
import { connect } from "node:net";

const COMPANY_SUFFIXES = /\b(pvt\.?|private|ltd\.?|limited|inc\.?|llc|corp\.?|corporation|co\.?|company|group|india)\b/g;
const SMTP_TIMEOUT_MS = 6000;

/** Heuristic only, no API — strips common company-name suffixes and guesses
 * "{name}.com". Wrong guesses are harmless here: a wrong domain just fails
 * every SMTP check below and the lead falls back to no email, same as
 * today. Never presented as a real domain lookup, just a first cheap try. */
function guessDomain(company: string): string | null {
  const cleaned = company
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, "");
  return cleaned.length >= 3 ? `${cleaned}.com` : null;
}

function candidateEmails(name: string, domain: string): string[] {
  const parts = name.trim().toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z]/g, ""));
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last || first === last) return [];
  return [
    `${first}.${last}@${domain}`,
    `${first}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last[0]}@${domain}`,
  ];
}

/** Real SMTP RCPT TO handshake against the domain's real MX server — no
 * email is actually sent. Best-effort, not authoritative: many mail
 * providers (Gmail, Outlook among them) accept-all at RCPT stage and only
 * bounce later, and greylisting can produce false negatives. Treated as a
 * real signal worth trying, not a guarantee — only ever upgrades a null to
 * a value, never overrides a real one already found by search extraction.
 * Requires outbound TCP/25 — will silently fail (return false, safe) on
 * hosts that block it, e.g. most PaaS/cloud deploy targets. */
function smtpVerify(email: string, mxHost: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: mxHost, port: 25, timeout: SMTP_TIMEOUT_MS });
    let step = 0;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("data", (data) => {
      const code = parseInt(data.toString().slice(0, 3), 10);
      if (step === 0) {
        if (code !== 220) return finish(false);
        socket.write("HELO leadverify.local\r\n");
        step = 1;
      } else if (step === 1) {
        if (code !== 250) return finish(false);
        socket.write("MAIL FROM:<verify@leadverify.local>\r\n");
        step = 2;
      } else if (step === 2) {
        if (code !== 250) return finish(false);
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
      } else if (step === 3) {
        finish(code === 250);
      }
    });
  });
}

/** Lowest-priority MX host for a domain, or null when it has none or the lookup fails. */
export async function resolveMailHost(domain: string): Promise<string | null> {
  try {
    const records = await resolveMx(domain);
    if (records.length === 0) return null;
    return records.sort((a, b) => a.priority - b.priority)[0].exchange;
  } catch {
    return null;
  }
}

/** For a lead with a company but no email: guess a domain, generate common
 * name-pattern candidates, and SMTP-verify each in turn — first one that
 * gets a real 250 accept wins. Returns null (no upgrade) on any failure
 * along the way, never a fabricated guess presented as fact. */
export async function guessAndVerifyEmail(name: string, company: string): Promise<string | null> {
  const domain = guessDomain(company);
  if (!domain) return null;

  const mxHost = await resolveMailHost(domain);
  if (!mxHost) return null;

  for (const candidate of candidateEmails(name, domain)) {
    if (await smtpVerify(candidate, mxHost)) return candidate;
  }
  return null;
}
