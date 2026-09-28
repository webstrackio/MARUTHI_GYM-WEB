import "dotenv/config";
import express from "express";
import { execFileSync } from "node:child_process";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
// Best-effort, read-only lookup of whatever is holding a TCP port. This is
// only ever used to *report* a clash so the owner knows which process to stop;
// nothing here ever kills a process, and a failure to look one up is not an
// error - the report just omits the owner details.
function findPortOwner(port) {
    try {
        if (process.platform === "win32") {
            const rows = execFileSync("netstat", ["-ano"], { encoding: "utf8", timeout: 5000 })
                .split(/\r?\n/)
                // Listening sockets on this port, with a PID in the last column.
                // `[:.]` also matches the 5000 inside 50001, so the port number
                // is required to be followed by whitespace.
                .filter((line) => /LISTENING/i.test(line) && new RegExp(`[:.]${port}\\s`).test(line));
            const pid = rows.map((line) => line.trim().split(/\s+/).pop()).find(Boolean);
            if (!pid) {
                return null;
            }
            let name = "unknown";
            let commandLine = "";
            try {
                const info = execFileSync("powershell", [
                    "-NoProfile", "-Command",
                    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.Name + '|' + $p.CommandLine }`,
                ], { encoding: "utf8", timeout: 10000 }).trim();
                const [processName, ...rest] = info.split("|");
                name = processName || name;
                commandLine = rest.join("|").trim();
            }
            catch (_err) {
                // Process may have exited between netstat and the lookup.
            }
            return { pid, name, commandLine };
        }
        const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
        const rows = out.split(/\r?\n/).slice(1).filter(Boolean);
        if (!rows.length) {
            return null;
        }
        const fields = rows[0].trim().split(/\s+/);
        return {
            pid: fields[1],
            name: fields[0],
            commandLine: execFileSync("ps", ["-o", "args=", "-p", fields[1]], { encoding: "utf8", timeout: 5000 }).trim(),
        };
    }
    catch (_err) {
        return null;
    }
}
// Explains an EADDRINUSE in terms the owner can act on. Deliberately does not
// move to another port (that hides the clash and silently splits traffic
// between two instances) and does not kill anything (the listener may be an
// unrelated application).
function reportPortInUse(port, error) {
    console.error(`\nCannot start: port ${port} is already in use (${error.code || "EADDRINUSE"}).`);
    const owner = findPortOwner(port);
    if (!owner) {
        console.error(`No listening process on ${port} could be identified, so the port may be held by a`);
        console.error("process this user cannot inspect, or it may have just been released. Try again.");
    }
    else {
        console.error(`\n  Port    ${port}`);
        console.error(`  PID     ${owner.pid}`);
        console.error(`  Process ${owner.name}${owner.commandLine ? `\n  Command ${owner.commandLine}` : ""}`);
        if (owner.name && owner.commandLine && /node/i.test(owner.name) && /server\/index\.js/.test(owner.commandLine)) {
            console.error("\nThis is another instance of this project, started by an earlier `npm run dev`.");
        }
    }
    console.error("\nStop that process, then run `npm run dev` again:");
    console.error(`  Stop-Process -Id ${owner?.pid ?? "<PID>"}`);
    console.error(`  # if it refuses to exit:`);
    console.error(`  taskkill /PID ${owner?.pid ?? "<PID>"} /F`);
    console.error(`\nTo run this server on a different port instead, use the PORT variable:`);
    console.error(`  $env:PORT = "5001"; npm run dev`);
    console.error("\nThis server will not kill an unrelated process for you.\n");
}
const app = express();
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse = undefined;
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
            let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
            if (capturedJsonResponse) {
                logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
            }
            if (logLine.length > 80) {
                logLine = logLine.slice(0, 79) + "…";
            }
            log(logLine);
        }
    });
    next();
});
(async () => {
    const server = await registerRoutes(app);
    app.use((err, _req, res, _next) => {
        console.error(err.stack || err);
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        res.status(status).json({ message });
    });
    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    const isDev = (process.env.NODE_ENV || "").trim() === "development";
    log(`isDev = ${isDev}, setting up ${isDev ? "Vite" : "Static"} server`);
    let vite = null;
    if (isDev) {
        vite = await setupVite(app, server);
    }
    else {
        serveStatic(app);
    }
    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const rawPort = process.env.PORT ?? "5000";
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT must be a number between 1 and 65535, received ${JSON.stringify(rawPort)}`);
    }
    // `reusePort` is not supported on some platforms (notably Windows),
    // which causes an ENOTSUP error. Only set it when the platform
    // supports it.
    const listenOptions = {
        port,
        // Loopback only. Binding 0.0.0.0 would also expose the API to every
        // device on the network, which is not wanted here. Note this means the
        // attendance pad can no longer be opened on a phone or tablet.
        host: "127.0.0.1",
    };
    if (process.platform !== "win32") {
        listenOptions.reusePort = true;
    }
    // Listen is awaited instead of fire-and-forget, so a bind failure is a
    // rejected promise we can report properly. Without this, `server.listen`
    // emits an 'error' event with no listener and the process dies on an
    // unhandled error, printing a bare stack trace with no hint that another
    // instance is already running.
    try {
        await new Promise((resolve, reject) => {
            const onError = (err) => {
                server.off("listening", onListening);
                reject(err);
            };
            const onListening = () => {
                server.off("error", onError);
                resolve();
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(listenOptions);
        });
    }
    catch (err) {
        if (err?.code === "EADDRINUSE") {
            reportPortInUse(port, err);
            // Nothing is bound, so exit rather than linger as a half-started
            // process. A non-zero code stops a supervisor or a chained command
            // from treating the failure as success.
            process.exit(1);
        }
        throw err;
    }
    log(`serving on port ${port}`);
    // --- Graceful shutdown -------------------------------------------------
    // Without this, Ctrl+C kills node before the socket is closed cleanly, and
    // the listening socket can survive long enough for the next `npm run dev`
    // to hit EADDRINUSE. Closing the server is what actually releases the port.
    // Browsers also keep HTTP/1.1 keep-alive sockets open, which makes
    // `server.close()` wait for a request that may never come, so idle sockets
    // are dropped immediately and the rest are cut loose shortly after.
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        log(`received ${signal}, shutting down`);
        const forceAll = setTimeout(() => {
            server.closeAllConnections?.();
        }, 3000);
        // Last resort: a shutdown that hangs must not hold the port forever.
        const hardExit = setTimeout(() => {
            console.error("shutdown timed out, exiting");
            process.exit(1);
        }, 10000);
        forceAll.unref();
        hardExit.unref();
        const done = (err) => {
            clearTimeout(forceAll);
            clearTimeout(hardExit);
            if (err) {
                console.error(err.stack || err);
                process.exit(1);
            }
            log("shutdown complete");
            process.exit(0);
        };
        try {
            // Vite holds no port of its own, but its file watchers and HMR
            // channel keep the event loop alive, so the process would linger
            // after the socket is gone unless they are closed too.
            await vite?.close();
        }
        catch (err) {
            console.error(`error while closing Vite: ${err?.message || err}`);
        }
        server.close(done);
        server.closeIdleConnections?.();
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
})();
