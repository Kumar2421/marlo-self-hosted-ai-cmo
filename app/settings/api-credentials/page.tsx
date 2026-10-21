"use client";

import { Suspense } from "react";
import PageSpeedCard from "@/components/settings/PageSpeedCard";
import TavilyCard from "@/components/settings/TavilyCard";
import GeminiCard from "@/components/settings/GeminiCard";
import GoogleCloudCard from "@/components/settings/GoogleCloudCard";
import GmailCard from "@/components/settings/GmailCard";
import GoogleAnalyticsCard from "@/components/settings/GoogleAnalyticsCard";
import GitHubCodeFixCard from "@/components/settings/GitHubCodeFixCard";
import CompetitorDiscoveryToggle from "@/components/settings/CompetitorDiscoveryToggle";

export default function ApiCredentialsPage() {
  return (
    <div className="min-w-0 max-w-3xl">
      <h1 className="text-[15px] font-semibold text-gray-900">API Credentials</h1>
      <p className="mb-4 text-[13px] text-gray-500">
        External services that ground agents in real data — separate from the LLM providers that
        do the writing.
      </p>

      <div className="space-y-3">
        <PageSpeedCard />
        <TavilyCard />
        <GeminiCard />
        <Suspense fallback={null}>
          <GoogleCloudCard />
        </Suspense>
        <Suspense fallback={null}>
          <GmailCard />
        </Suspense>
        <Suspense fallback={null}>
          <GoogleAnalyticsCard />
        </Suspense>
        <GitHubCodeFixCard />
        <CompetitorDiscoveryToggle />
      </div>
    </div>
  );
}
