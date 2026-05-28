import type { FastifyInstance } from "fastify";
import { EventSchema } from "../schemas/event.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { verifyHmac } from "../modules/auth/hmac.js";
import { persistEvent } from "../modules/ingestion/persist-event.js";
import { config } from "../config.js";

export async function eventsRoute(app: FastifyInstance) {
  app.post("/v1/events", async (req, reply) => {
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

    // --- HMAC ---
    if (config.hmacRequired) {
      if (!config.hmacSecret) {
        req.log.error("HMAC_REQUIRED is true but HMAC_SECRET is not set");
        return reply.status(500).send({ error: "Server misconfiguration" });
      }
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      const signature = req.headers["x-rasp-signature"] as string | undefined;
      if (!rawBody || !verifyHmac(rawBody, signature, config.hmacSecret)) {
        return reply.status(401).send({ error: "Invalid HMAC signature" });
      }
    }

    // --- Payload validation ---
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid payload",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const payload = parsed.data;

    // --- redacted must be true ---
    if (!payload.metadata?.redacted) {
      return reply
        .status(400)
        .send({ error: "Events must be redacted before submission (metadata.redacted must be true)" });
    }

    // --- projectId consistency ---
    if (payload.projectId !== auth.projectId) {
      return reply.status(403).send({ error: "projectId does not match API key" });
    }

    // --- Persist ---
    const result = await persistEvent(payload, auth.projectId);

    req.log.info({
      eventId: result.eventId,
      projectId: auth.projectId,
      agentId: payload.agentId,
      eventType: payload.eventType,
      severity: payload.severity,
      path: payload.path,
      method: payload.method,
      alertCreated: result.alertCreated,
    }, "event accepted");

    return reply.status(202).send({ accepted: true, eventId: result.eventId });
  });
}
