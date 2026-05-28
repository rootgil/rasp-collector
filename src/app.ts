import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { healthRoute } from "./routes/health.route.js";
import { eventsRoute } from "./routes/events.route.js";
import { heartbeatRoute } from "./routes/heartbeat.route.js";

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: config.maxEventSizeBytes,
    trustProxy: true,
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Rate limiting - per IP by default; agents get 600 req/min
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: "1 minute",
    errorResponseBuilder(_req, context) {
      return {
        statusCode: 429,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${context.after}.`,
      };
    },
  });

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

  return app;
}
