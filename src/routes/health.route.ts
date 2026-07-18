import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";

async function checkRedis(): Promise<"ok" | "degraded" | "disabled"> {
  if (!config.queueEnabled) return "disabled";

  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  try {
    await client.connect();
    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000)
      ),
    ]);
    return pong === "PONG" ? "ok" : "degraded";
  } catch {
    return "degraded";
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", {
    schema: {
      tags: ["health"],
      summary: "Service health check",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            service: { type: "string", example: "rasp-collector" },
            version: { type: "string", example: "0.1.0" },
            timestamp: { type: "string", format: "date-time" },
            db: { type: "string", example: "ok" },
            redis: { type: "string", example: "ok" },
            queue: { type: "boolean", example: true },
          },
        },
        503: {
          type: "object",
          properties: {
            status: { type: "string", example: "degraded" },
            service: { type: "string", example: "rasp-collector" },
            version: { type: "string", example: "0.1.0" },
            timestamp: { type: "string", format: "date-time" },
            db: { type: "string", example: "degraded" },
            redis: { type: "string", example: "degraded" },
            queue: { type: "boolean", example: true },
          },
        },
      },
    },
  }, async (_req, reply) => {
    let dbStatus: "ok" | "degraded" = "ok";
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
    } catch {
      dbStatus = "degraded";
    }

    const redisStatus = await checkRedis();

    const unhealthy =
      dbStatus !== "ok" ||
      (config.queueEnabled && redisStatus !== "ok");

    const status = unhealthy ? "degraded" : "ok";
    return reply.status(status === "ok" ? 200 : 503).send({
      status,
      service: "rasp-collector",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      db: dbStatus,
      redis: redisStatus,
      queue: config.queueEnabled,
    });
  });
}
