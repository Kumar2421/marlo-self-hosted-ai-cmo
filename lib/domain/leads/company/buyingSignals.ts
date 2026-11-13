/**
 * Buying signals read from a company's own pages: facts the page states, never guesses. A company that is hiring or
 * opening a new place is growing and more likely to need help, and the signal gives a real, checkable opener for a
 * first message. Pure, so every rule is unit-tested. The reason a lead is saved carries them as "Signals: ...".
 */

export type SignalId = "hiring" | "new_location";

export const SIGNAL_LABELS: Record<SignalId, string> = {
  hiring: "hiring now",
  new_location: "new location",
};

/**
 * A "Careers" link sits in almost every company's menu all year, so a link alone says nothing about hiring now (a
 * real run flagged half of all companies on it). Only wording that itself announces openings counts: a sentence on
 * the page, or a link whose own text announces it ("We're hiring", "Join our team", "Open positions").
 */
const HIRING_ANNOUNCEMENT = /\b(we(?:'re| are) hiring|now hiring|join our team|open (?:positions|roles|vacancies)|current (?:openings|vacancies))\b/i;
/** A new branch or a grand opening, stated in the page text. */
const NEW_LOCATION_TEXT =
  /\b(new (?:branch|location|clinic|store|outlet|office|showroom|studio|centre|center)|now open(?! hours)|grand opening|opening soon|recently opened|we(?:'ve| have) moved)\b/i;

export type PageLink = { href: string; text: string };

/** Signals one page states. The page's visible text and its links are all that is read. */
export function detectSignals(text: string, links: readonly PageLink[]): SignalId[] {
  const found: SignalId[] = [];
  if (HIRING_ANNOUNCEMENT.test(text) || links.some((l) => HIRING_ANNOUNCEMENT.test(l.text))) found.push("hiring");
  if (NEW_LOCATION_TEXT.test(text)) found.push("new_location");
  return found;
}

export function mergeSignals(...lists: ReadonlyArray<readonly SignalId[] | undefined>): SignalId[] {
  const seen = new Set<SignalId>();
  for (const list of lists) for (const id of list ?? []) seen.add(id);
  return (Object.keys(SIGNAL_LABELS) as SignalId[]).filter((id) => seen.has(id));
}

/** "Signals: hiring now; new location." or an empty string. */
export function signalsSentence(signals: readonly SignalId[]): string {
  return signals.length === 0 ? "" : `Signals: ${signals.map((s) => SIGNAL_LABELS[s]).join("; ")}.`;
}

/** The signals recorded in a saved fit reason, so the list and the draft can use them without another column. */
export function signalsFromReason(reason: string | null | undefined): SignalId[] {
  const m = /Signals: ([^.]+)\./.exec(reason ?? "");
  if (!m) return [];
  const labels = m[1].split(";").map((s) => s.trim());
  return (Object.keys(SIGNAL_LABELS) as SignalId[]).filter((id) => labels.includes(SIGNAL_LABELS[id]));
}

/** The reason without its "Signals: ..." sentence, for the list, where the signals already show as chips. */
export function reasonWithoutSignals(reason: string | null | undefined): string {
  return (reason ?? "").replace(/\s*Signals: [^.]+\./, "").trim();
}
