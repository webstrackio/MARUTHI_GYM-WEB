import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    // Only the server-side / shared test files. The React pages are exercised
    // through the browser, not jsdom, so nothing here needs a DOM environment.
    include: ["tests/**/*.test.js"],
    environment: "node",
    // The Cloud API is replaced by an injected fetch, so no test may reach the
    // network. Failing loudly on a stray request is the whole point.
    globals: false,
  },
});
