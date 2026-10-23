import GitHubCodeFixCard from "@/components/settings/GitHubCodeFixCard";
import WordPressCard from "@/components/settings/WordPressCard";
import WebflowCard from "@/components/settings/WebflowCard";
import GoogleAnalyticsCard from "@/components/settings/GoogleAnalyticsCard";
import GmailCard from "@/components/settings/GmailCard";
import { FEATURES } from "@/lib/features";

// Only connections that are really built live here: WordPress (self-hosted), Webflow,
// GitHub (SEO agent PRs), Gmail (platform mode) and Google Analytics/Search Console.
export default function IntegrationsPage() {
  return (
    <div className="min-w-0 max-w-4xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Article Publishing</h1>
      <p className="mb-4 text-[13px] text-gray-500">Publish articles directly to your CMS or blog platform</p>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <WordPressCard />
        <WebflowCard />
      </div>

      <h2 className="text-[15px] font-semibold text-gray-900">Code Repository</h2>
      <p className="mb-4 text-[13px] text-gray-500">Connect a GitHub repo so the SEO agent can open pull requests against it</p>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GitHubCodeFixCard />
      </div>

      {FEATURES.PLATFORM_MODE && (
        <>
          <h2 className="text-[15px] font-semibold text-gray-900">Email outreach</h2>
          <p className="mb-4 text-[13px] text-gray-500">
            Connect Gmail to send and follow up on lead outreach from your own address.
          </p>
          <div className="mb-8">
            <GmailCard />
          </div>
        </>
      )}

      <h2 className="text-[15px] font-semibold text-gray-900">Analytics</h2>
      <p className="mb-4 text-[13px] text-gray-500">
        Connect analytics tools to track performance. Disconnecting will remove the connector and all collected data.
      </p>
      <GoogleAnalyticsCard />
    </div>
  );
}
