import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostinger runs the isolated Linux standalone artifact assembled by
  // scripts/package-hostinger.mjs. The artifact is validated before upload.
  output: "standalone",
  // Keep tracing rooted at this app so worktrees or parent package manifests
  // cannot silently alter the standalone dependency closure.
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
};

export default nextConfig;
