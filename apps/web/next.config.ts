import path from "node:path";
import type { NextConfig } from "next";
import { apiInternalUrl } from "./lib/api";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: trace files from the repository root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  // Browser-facing auth routes are proxied to the api service. Destination is fixed at build time
  // (Dockerfile ARG API_INTERNAL_URL, default http://api:3001).
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${apiInternalUrl()}/auth/:path*` },
      // Browser-side data calls: /api/projects → api /projects. The api still enforces session, RBAC and Origin.
      { source: "/api/:path*", destination: `${apiInternalUrl()}/:path*` },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
};

export default nextConfig;
