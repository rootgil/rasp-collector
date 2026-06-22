import "dotenv/config";
import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";

/**
 * Load TLS options from paths declared in env vars.
 * Returns undefined when TLS is not configured (plain-HTTP mode, for
 * deployments that terminate TLS at the load balancer instead).
 *
 * When mTLS is required the CA bundle is loaded so Node.js can verify the
 * client certificate chain. Fingerprint allow-listing is enforced by the
 * onRequest hook in app.ts.
 */
function loadTlsOptions(): ServerOptions | undefined {
  if (!config.tlsCertPath || !config.tlsKeyPath) return undefined;
  const opts: ServerOptions = {
    cert: readFileSync(config.tlsCertPath),
    key: readFileSync(config.tlsKeyPath),
    minVersion: "TLSv1.3",
    // In mTLS mode: request the client cert but do NOT auto-reject unknown CAs —
    // the fingerprint allow-list in app.ts provides the actual enforcement so
    // operators can rotate certs without restarting the server.
    requestCert: config.mtlsRequired,
    rejectUnauthorized: false,
  };
  if (config.tlsCaPath) {
    opts.ca = readFileSync(config.tlsCaPath);
  }
  return opts;
}

async function start() {
  const httpsOpts = loadTlsOptions();
  const app = await buildApp(httpsOpts);

  try {
    await app.listen({ port: config.port, host: config.host });
    const scheme = httpsOpts ? "https" : "http";
    app.log.info(
      { tls: !!httpsOpts, mtls: config.mtlsRequired },
      `rasp-collector listening on ${scheme}://${config.host}:${config.port}`
    );
  } catch (err) {
    app.log.error(err, "failed to start server");
    await prisma.$disconnect();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
