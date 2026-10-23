/** Plain-language status line for each chat tool, shown as a chip while the assistant works. */
const TOOL_STATUS: Record<string, string> = {
  get_search_summary: "Checking your search performance...",
  list_opportunities: "Looking for search opportunities...",
  list_findings: "Reading your findings...",
  get_finding: "Opening a finding...",
  list_actions_and_outcomes: "Checking what your fixes did...",
  list_leads: "Looking at your leads...",
  get_geo_status: "Checking your AI-search visibility...",
  get_audit_summary: "Checking your latest audit...",
  list_competitors: "Looking at your competitors...",
};

export const THINKING_LABEL = "Thinking...";

export function toolStatusLabel(tool: string): string {
  return TOOL_STATUS[tool] ?? "Looking that up...";
}
