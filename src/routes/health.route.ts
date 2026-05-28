import type { FastifyInstance } from "fastify";

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    return reply.send({
      status: "ok",
      service: "rasp-collector",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });
}
