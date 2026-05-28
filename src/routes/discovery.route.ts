import type { FastifyInstance } from "fastify";
import { DiscoveryPayloadSchema } from "../schemas/discovery.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { persistDiscovery } from "../modules/ingestion/persist-discovery.js";

export async function discoveryRoute(app: FastifyInstance) {
  app.post("/v1/discovery", async (req, reply) => {
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
    const parsed = DiscoveryPayloadSchema.safeParse(req.body);
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

    const count = await persistDiscovery(payload);

    req.log.info(
      { agentId: payload.agentId, projectId: auth.projectId, count },
      "discovery batch accepted"
    );

    return reply.status(202).send({ accepted: true, count });
  });
}
