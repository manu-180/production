import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "lib/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.ts",
      "app/**/*.test.ts",
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
