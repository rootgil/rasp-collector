import Fastify from "fastify";
import { createHash } from "node:crypto";
import type { ServerOptions } from "node:https";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}
import { logger } from "./lib/logger.js";
import { healthRoute } from "./routes/health.route.js";
import { eventsRoute } from "./routes/events.route.js";
import { heartbeatRoute } from "./routes/heartbeat.route.js";
import { discoveryRoute } from "./routes/discovery.route.js";
import { policyRoute } from "./routes/policy.route.js";
import { pruneVolumeCounters } from "./modules/ingestion/volume-monitor.js";

export async function buildApp(httpsOpts?: ServerOptions) {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: config.maxEventSizeBytes,
    // Only trust a proxy header when TLS is NOT terminated here; when we own
    // TLS we see the real client socket and proxy headers become a spoofing risk.
    trustProxy: !httpsOpts,
    ...(httpsOpts ? { https: httpsOpts } : {}),
  });

  // OpenAPI spec + Swagger UI (registered first so all route schemas are captured)
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "RASP Collector API",
        description:
          "Telemetry ingestion endpoint for RASP agents. Agents authenticate with a Bearer API key and submit security events, heartbeats, and endpoint-discovery batches.",
        version: "0.1.0",
      },
      servers: [{ url: `http://localhost:${config.port}`, description: "Local" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key issued by the RASP platform (Authorization: Bearer <key>)",
          },
        },
      },
      tags: [
        { name: "health", description: "Service health check" },
        { name: "ingestion", description: "Agent telemetry ingestion" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: false,
  });

  // Skip AJV body validation; Zod inside each handler is the source of truth.
  app.setValidatorCompiler(() => () => true);
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Capture the raw request body so HMAC can be verified over the exact bytes
  // the agent signed (Addendum E.5). We parse JSON ourselves and stash the
  // buffer on `req.rawBody`.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        const json = (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {};
        done(null, json);
      } catch {
        done(new Error("Invalid JSON"), undefined);
      }
    }
  );

  // Rate limiting - keyed per API key (per-tenant) when present, else per IP.
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: "1 minute",
    keyGenerator(req) {
      const auth = req.headers["authorization"];
      if (typeof auth === "string" && auth.startsWith("Bearer ")) {
        // Hash the key so the bucket id is not the raw secret.
        return "k:" + hashKey(auth.slice(7).trim());
      }
      return "ip:" + req.ip;
    },
    errorResponseBuilder(_req, context) {
      return {
        statusCode: 429,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${context.after}.`,
      };
    },
  });

  // Mutual-TLS client certificate verification (Addendum E.4.2). Only enforced
  // when MTLS_REQUIRED=true and the collector terminates TLS with requestCert.
  if (config.mtlsRequired) {
    app.addHook("onRequest", async (req, reply) => {
      const socket = req.raw.socket as unknown as {
        getPeerCertificate?: () => { raw?: Buffer };
        authorized?: boolean;
      };
      if (typeof socket.getPeerCertificate !== "function") {
        return reply.status(496).send({ error: "Client certificate required" });
      }
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.raw) {
        return reply.status(496).send({ error: "Client certificate required" });
      }
      const fp = createHash("sha256").update(cert.raw).digest("hex");
      if (
        config.mtlsAllowedFingerprints.length > 0 &&
        !config.mtlsAllowedFingerprints.includes(fp)
      ) {
        return reply.status(403).send({ error: "Client certificate not allowed" });
      }
    });
  }

  // Global error handler
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode;
    // Fastify body limit error
    if (statusCode === 413) {
      return reply.status(413).send({ error: "Payload too large" });
    }
    app.log.error({ err: error }, "unhandled error");
    return reply.status(statusCode ?? 500).send({
      error: error.message ?? "Internal server error",
    });
  });

  // Routes
  await app.register(healthRoute);
  await app.register(eventsRoute);
  await app.register(heartbeatRoute);
  await app.register(discoveryRoute);
  await app.register(policyRoute);

  // Prune in-memory volume counters every minute to prevent unbounded growth
  const pruneInterval = setInterval(pruneVolumeCounters, 60_000);
  app.addHook("onClose", () => clearInterval(pruneInterval));

  return app;
}
