import type { FastifyInstance } from "fastify";
import { HeartbeatSchema } from "../schemas/heartbeat.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { persistHeartbeat } from "../modules/ingestion/persist-heartbeat.js";

export async function heartbeatRoute(app: FastifyInstance) {
  app.post("/v1/heartbeat", async (req, reply) => {
    // --- Auth ---
    let auth: { projectId: string; apiKeyId: string };
    try {
      auth = await verifyApiKey(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: err.message });
      }
      throw err;
    }

    // --- Payload validation ---
    const parsed = HeartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid payload",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const payload = parsed.data;

    if (payload.projectId !== auth.projectId) {
      return reply.status(403).send({ error: "projectId does not match API key" });
    }

    let result;
    try {
      result = await persistHeartbeat(payload);
    } catch (err) {
      if ((err as { code?: string }).code === "AGENT_NOT_FOUND") {
        return reply.status(404).send({
          error: "Agent not found. Register your agent in the dashboard first.",
        });
      }
      throw err;
    }

    req.log.info({
      agentId: payload.agentId,
      projectId: auth.projectId,
      agentVersion: payload.agentVersion,
      killSwitch: result.killSwitch,
    }, "heartbeat received");

    return reply.send(result);
  });
}
