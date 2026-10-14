import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostinger runs the isolated Linux standalone artifact assembled by
  // scripts/package-hostinger.mjs. The artifact is validated before upload.
  output: "standalone",
  // Trace the native database driver into the physical runtime dependency tree.
  serverExternalPackages: ["mysql2"],
  // Keep tracing rooted at this app so worktrees or parent package manifests
  // cannot silently alter the standalone dependency closure.
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
};

export default nextConfig;
