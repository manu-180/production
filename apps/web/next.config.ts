import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// Load the monorepo-root `.env` so apps/web doesn't need to duplicate it.
// Existing `process.env` values win — Vercel/CI envs and `apps/web/.env*` are
// already loaded before this file runs.
loadDotenv({ path: resolve(__dirname, "../../.env"), override: false });

const nextConfig: NextConfig = {
  transpilePackages: ["@conductor/core", "@conductor/db"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // Node.js built-ins are not available in the browser bundle.
      // Mark them as empty so webpack doesn't error on transitive imports.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        child_process: false,
        fs: false,
        path: false,
        os: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
