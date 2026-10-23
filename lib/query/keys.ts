/**
 * Query keys. Everything that belongs to a project starts with
 * ["project", projectId], so switching projects can never serve another
 * project's data, and a whole project's cache can be dropped or refreshed
 * with one prefix.
 */
const scope = (projectId: string | undefined) => ["project", projectId ?? "none"] as const;

/** Account-level data that is the same for every project. */
const account = ["account"] as const;

export const qk = {
  authUser: () => [...account, "auth-user"] as const,
  providers: (userId: string | null) => [...account, "providers", userId ?? "anonymous"] as const,
  gmailStatus: () => [...account, "gmail-status"] as const,
  outreachStatus: () => [...account, "outreach-status"] as const,
  outreachPlan: (leadIds: string[], acceptGuessed: boolean) => [...account, "outreach-plan", [...leadIds].sort().join(","), acceptGuessed] as const,
  plan: () => [...account, "plan"] as const,
  chatAllowance: () => [...account, "chat-allowance"] as const,
  usage: () => [...account, "usage"] as const,
  notifications: () => [...account, "notifications"] as const,
  notificationPrefs: () => [...account, "notification-prefs"] as const,
  project: scope,
  dashboardData: (projectId: string | undefined) => [...scope(projectId), "dashboard-data"] as const,
  audit: (projectId: string | undefined, url: string | undefined, version: number) =>
    [...scope(projectId), "audit", url ?? "", version] as const,
  links: (projectId: string | undefined) => [...scope(projectId), "links"] as const,
  geo: (projectId: string | undefined) => [...scope(projectId), "geo"] as const,
  geoOverview: (projectId: string | undefined) => [...scope(projectId), "geo-overview"] as const,
  geoReadiness: (projectId: string | undefined) => [...scope(projectId), "geo-readiness"] as const,
  geoReferral: (projectId: string | undefined) => [...scope(projectId), "geo-referral"] as const,
  geoHistory: (projectId: string | undefined, prompt: string) => [...scope(projectId), "geo-history", prompt] as const,
  siteCrawl: (projectId: string | undefined) => [...scope(projectId), "site-crawl"] as const,
  traffic: (projectId: string | undefined) => [...scope(projectId), "traffic"] as const,
  googleConnection: (projectId: string | undefined) => [...scope(projectId), "google-connection"] as const,
  googleResources: (projectId: string | undefined) => [...scope(projectId), "google-resources"] as const,
  searchHistory: (projectId: string | undefined) => [...scope(projectId), "search-history"] as const,
  findings: (projectId: string | undefined) => [...scope(projectId), "findings"] as const,
  findingRecommendations: (projectId: string | undefined, findingId: string) =>
    [...scope(projectId), "findings", findingId, "recommendations"] as const,
  findingActions: (projectId: string | undefined, findingId: string) =>
    [...scope(projectId), "findings", findingId, "actions"] as const,
  /** How many leads the Leads panel last loaded; the top bar reads it without fetching. */
  leadsCount: (projectId: string | undefined) => [...scope(projectId), "leads-count"] as const,
  leadProfile: (projectId: string | undefined) => [...scope(projectId), "lead-profile"] as const,
  redditSettings: (projectId: string | undefined) => [...scope(projectId), "reddit-settings"] as const,
  socialDailySettings: (projectId: string | undefined) => [...scope(projectId), "social-daily-settings"] as const,
  automation: (projectId: string | undefined) => [...scope(projectId), "automation"] as const,
  searchOpportunities: (projectId: string | undefined) => [...scope(projectId), "search-opportunities"] as const,
  cmsStatus: () => [...account, "cms-status"] as const,
  githubStatus: (projectId: string | undefined) => [...scope(projectId), "github-status"] as const,
  xDrafts: (projectId: string | undefined, view: "current" | "archived") => [...scope(projectId), "x-drafts", view] as const,
  xDraftsAll: (projectId: string | undefined) => [...scope(projectId), "x-drafts"] as const,
  linkedInDrafts: (projectId: string | undefined, view: "current" | "archived") => [...scope(projectId), "linkedin-drafts", view] as const,
  linkedInDraftsAll: (projectId: string | undefined) => [...scope(projectId), "linkedin-drafts"] as const,
  redditDrafts: (projectId: string | undefined, view: "current" | "archived") => [...scope(projectId), "reddit-drafts", view] as const,
  redditDraftsAll: (projectId: string | undefined) => [...scope(projectId), "reddit-drafts"] as const,
  searchOverview: (projectId: string | undefined) => [...scope(projectId), "search-overview"] as const,
};
