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
    // No test may reach the network. The payment route used to fan out to the
    // WhatsApp Cloud API on every saved payment, but that sender has been
    // removed, so the route now only touches the mocked storage layer and there
    // is no longer a client left that could dial out.
    globals: false,
  },
});
