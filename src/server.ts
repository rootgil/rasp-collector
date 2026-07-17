import "dotenv/config";
import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { closeQueue, isQueueEnabled, startEventsWorker } from "./queue/events.queue.js";

/**
 * Load TLS options from paths declared in env vars.
 * Returns undefined when TLS is not configured (plain-HTTP mode, for
 * deployments that terminate TLS at the load balancer instead).
 */
function loadTlsOptions(): ServerOptions | undefined {
  if (!config.tlsCertPath || !config.tlsKeyPath) return undefined;
  const opts: ServerOptions = {
    cert: readFileSync(config.tlsCertPath),
    key: readFileSync(config.tlsKeyPath),
    minVersion: "TLSv1.3",
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

  if (isQueueEnabled()) {
    startEventsWorker();
    app.log.info({ redisUrl: config.redisUrl }, "events worker started (QUEUE_ENABLED=true)");
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    const scheme = httpsOpts ? "https" : "http";
    app.log.info(
      { tls: !!httpsOpts, mtls: config.mtlsRequired, queue: isQueueEnabled() },
      `rasp-collector listening on ${scheme}://${config.host}:${config.port}`
    );
  } catch (err) {
    app.log.error(err, "failed to start server");
    await closeQueue();
    await prisma.$disconnect();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await closeQueue();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
