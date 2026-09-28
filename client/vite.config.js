import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
            "@shared": path.resolve(import.meta.dirname, "..", "shared"),
        },
    },
    root: import.meta.dirname,
    build: {
        outDir: path.resolve(import.meta.dirname, "..", "dist", "public"),
        emptyOutDir: true,
    },
    server: {
        // A bare `npx vite` run (as opposed to `npm run dev`) would normally
        // fall forward to 5001, 5002, ... when 5000 is taken. Fail instead, so
        // a stray port is never silently introduced. This is only a backstop:
        // under `npm run dev` the dev server is started in `middlewareMode` on
        // the Express HTTP server (see server/vite.js), which overrides this
        // whole `server` key and never binds a port at all. The single listener
        // for the app is Express, and it exits with a clear message rather than
        // retrying elsewhere.
        strictPort: true,
        fs: {
            strict: true,
            deny: ["**/.*"],
        },
    },
});
