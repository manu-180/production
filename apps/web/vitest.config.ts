import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
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
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
