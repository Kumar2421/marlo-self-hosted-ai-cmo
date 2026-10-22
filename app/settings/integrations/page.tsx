import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { Info } from "lucide-react";
import ComingSoonCard from "@/components/settings/ComingSoonCard";
import GitHubCodeFixCard from "@/components/settings/GitHubCodeFixCard";
import WordPressCard from "@/components/settings/WordPressCard";
import WebflowCard from "@/components/settings/WebflowCard";
import XConnectCard from "@/components/settings/XConnectCard";
import GoogleAnalyticsCard from "@/components/settings/GoogleAnalyticsCard";
import GmailCard from "@/components/settings/GmailCard";
import { FEATURES } from "@/lib/features";
import { cmsIntegrations, socialIntegrations, codeRepoIntegrations } from "@/lib/mock-integrations";

// Real, secure connections exist for WordPress (self-hosted), Webflow, GitHub, and X
// — everything else on this page is an honest "coming soon" rather than a
// fake toggle that stores nothing and resets on reload. GitHub is one real
// connection shared between the CMS "publish to repo" slot and the
// code-repo "SEO agent PRs" slot below, not two separate fake cards.
export default function IntegrationsPage() {
  return (
    <div className="min-w-0 max-w-4xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Article Publishing</h1>
      <p className="mb-4 text-[13px] text-gray-500">Publish articles directly to your CMS or blog platform</p>

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
        <Info size={14} className="shrink-0 text-gray-400" />
        You can connect one publishing destination at a time.
      </div>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cmsIntegrations.map((i) => {
          if (i.id === "wordpress-self") return <WordPressCard key={i.id} />;
          if (i.id === "webflow") return <WebflowCard key={i.id} />;
          // GitHub has one card: it lives under Code Repository below, so the
          // CMS slot is skipped here instead of showing the same connection twice.
          if (i.id === "github-articles") return null;
          return <ComingSoonCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />;
        })}
      </div>

      <h2 className="text-[15px] font-semibold text-gray-900">Socials</h2>
      <p className="mb-4 text-[13px] text-gray-500">Connect your social accounts to post and share content</p>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {socialIntegrations.map((i) => {
          if (i.name === "X (Twitter)") return <XConnectCard key={i.id} />;
          return <ComingSoonCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />;
        })}
      </div>

      <h2 className="text-[15px] font-semibold text-gray-900">Code Repository</h2>
      <p className="mb-4 text-[13px] text-gray-500">Connect a GitHub repo so the SEO agent can open pull requests against it</p>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {codeRepoIntegrations.map((i) =>
          i.id === "github-seo" ? <GitHubCodeFixCard key={i.id} /> : <ComingSoonCard key={i.id} name={i.name} desc={i.desc} icon={i.icon} color={i.color} />
        )}
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
