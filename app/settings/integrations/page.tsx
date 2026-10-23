import GitHubCodeFixCard from "@/components/settings/GitHubCodeFixCard";
import WordPressCard from "@/components/settings/WordPressCard";
import WebflowCard from "@/components/settings/WebflowCard";
import GoogleAnalyticsCard from "@/components/settings/GoogleAnalyticsCard";
import GmailCard from "@/components/settings/GmailCard";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/ui";
import { FEATURES } from "@/lib/features";

// Only connections that are really built live here: WordPress (self-hosted), Webflow,
// GitHub (SEO agent PRs), Gmail (platform mode) and Google Analytics/Search Console.
export default function IntegrationsPage() {
  return (
    <div className="min-w-0 max-w-4xl">
      <SettingsPageHeader title="Article Publishing" caption="Publish articles directly to your CMS or blog platform" />
      <div className="mb-10 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2">
        <WordPressCard />
        <WebflowCard />
      </div>

      <SettingsSection
        title="Code Repository"
        caption="Connect a GitHub repo so the SEO agent can open pull requests against it"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <GitHubCodeFixCard />
        </div>
      </SettingsSection>

      {FEATURES.PLATFORM_MODE && (
        <SettingsSection
          title="Email outreach"
          caption="Connect Gmail to send and follow up on lead outreach from your own address."
        >
          <GmailCard />
        </SettingsSection>
      )}

      <SettingsSection
        title="Analytics"
        caption="Connect analytics tools to track performance. Disconnecting will remove the connector and all collected data."
        className="mb-0"
      >
        <GoogleAnalyticsCard />
      </SettingsSection>
    </div>
  );
}
