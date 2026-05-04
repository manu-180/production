import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // API route tests + anything under app/api/** need Node primitives
    // (AbortSignal, Buffer) that jsdom shadows incorrectly.
    environmentMatchGlobs: [["app/api/**", "node"]],
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "lib/**/__tests__/**/*.test.ts",
      "lib/**/__tests__/**/*.test.tsx",
      "hooks/**/__tests__/**/*.test.ts",
      "hooks/**/__tests__/**/*.test.tsx",
      "app/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.tsx",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "components/**/__tests__/**/*.test.ts",
      "components/**/__tests__/**/*.test.tsx",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "**/e2e/**"],
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      exclude: [
        "node_modules",
        "dist",
        ".next",
        "**/*.d.ts",
        "**/__tests__/**",
        "**/vitest.setup.ts",
      ],
      thresholds: {
        global: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
