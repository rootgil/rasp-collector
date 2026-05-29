import type { FastifyInstance } from "fastify";

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
          },
        },
      },
    },
  }, async (_req, reply) => {
    return reply.send({
      status: "ok",
      service: "rasp-collector",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });
}
