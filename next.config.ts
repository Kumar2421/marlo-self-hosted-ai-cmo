import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/security/securityHeaders.ts";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon (self-host DB) — keep it out of the
  // serverless bundle instead of letting the bundler try to inline it; Next
  // ships it alongside the function as a real node_modules dependency instead.
  serverExternalPackages: ["better-sqlite3"],
  // The Docker image sets MARLO_STANDALONE=1 to get a self-contained server bundle (much smaller image).
  // Every other build, including Vercel, keeps the default output.
  output: process.env.MARLO_STANDALONE === "1" ? "standalone" : undefined,
  // Hide the framework fingerprint header.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
