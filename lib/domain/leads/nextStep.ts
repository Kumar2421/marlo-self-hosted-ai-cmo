/**
 * The one sentence a first-time user needs next in the Leads panel, from where they are. Pure, so the wording and
 * the order of the steps are unit-tested. Returns null once the user is past the early steps; the top bar then
 * carries the progress.
 */

export type NextStepInput = {
  /** A confirmed lead profile exists. */
  profileConfirmed: boolean;
  /** The profile names company types and no job title, so "Find companies" is the search. */
  companiesFirst: boolean;
  leadCount: number;
  qualified: number;
  reached: number;
};

export type NextStep = { id: "profile" | "find" | "none-qualified" | "reach"; text: string };

export function nextStep(i: NextStepInput): NextStep | null {
  if (!i.profileConfirmed) {
    return { id: "profile", text: "Tell Marlo who you sell to. It will find businesses and people you can reach." };
  }
  if (i.leadCount === 0) {
    return {
      id: "find",
      text: i.companiesFirst
        ? "Press Find companies. Marlo searches the web for businesses like your customers and keeps only the ones that show an email or WhatsApp number on their own site."
        : "Press Find leads. Marlo searches for people who match your profile and keeps the ones you can reach.",
    };
  }
  if (i.qualified === 0) {
    return {
      id: "none-qualified",
      text: "None of these are ready yet. A lead is ready when you can reach them, you know why they fit and you have a source page. Search again to find more.",
    };
  }
  if (i.reached === 0) {
    return { id: "reach", text: "Next: press Reach on a lead to draft a WhatsApp, LinkedIn or email message. You send it, so nothing goes out without you." };
  }
  return null;
}
