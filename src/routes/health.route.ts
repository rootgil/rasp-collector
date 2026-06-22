import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

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
          },
        },
      },
    },
  }, async (_req, reply) => {
    let dbStatus = "ok";
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
    } catch {
      dbStatus = "degraded";
    }

    const status = dbStatus === "ok" ? "ok" : "degraded";
    return reply.status(status === "ok" ? 200 : 503).send({
      status,
      service: "rasp-collector",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      db: dbStatus,
    });
  });
}
