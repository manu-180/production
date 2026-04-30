import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";
import { resolve } from "node:path";

// Load the monorepo-root `.env` so apps/web doesn't need to duplicate it.
// Existing `process.env` values win — Vercel/CI envs and `apps/web/.env*` are
// already loaded before this file runs.
loadDotenv({ path: resolve(__dirname, "../../.env"), override: false });

const nextConfig: NextConfig = {
  // Workspace packages ship raw TS with NodeNext-style `.js` extensions in
  // relative imports. transpilePackages tells Next/turbopack to compile them
  // through the same loader pipeline as app code; extensionAlias re-maps `.js`
  // import specifiers to their `.ts` source so the imports resolve.
  //
  // Note: extensionAlias is unsupported by turbopack — `pnpm dev` uses webpack
  // (see package.json scripts).
  transpilePackages: ["@conductor/core", "@conductor/db"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
};

export default nextConfig;
