import type { FastifyInstance } from "fastify";
import { EventSchema } from "../schemas/event.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { enforceHmac } from "../modules/auth/verify-request.js";
import { persistEvent } from "../modules/ingestion/persist-event.js";
import { trackVolume } from "../modules/ingestion/volume-monitor.js";
import { enqueueEvent, isQueueEnabled } from "../queue/events.queue.js";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

const eventBodySchema = {
  type: "object",
  required: ["projectId", "eventType", "severity"],
  properties: {
    projectId: { type: "string", minLength: 1, description: "Project identifier" },
    agentId: { type: "string", description: "Agent identifier" },
    agentVersion: { type: "string" },
    runtime: { type: "string", description: "e.g. node, python, java" },
    framework: { type: "string", description: "e.g. express, fastapi" },
    eventId: {
      type: "string",
      description: "Optional client event id for idempotency (or use X-Idempotency-Key header)",
    },
    eventType: { type: "string", minLength: 1, description: "e.g. sql-injection, xss" },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    action: { type: "string", enum: ["monitor", "block"], default: "monitor" },
    method: { type: "string", description: "HTTP method of the intercepted request" },
    path: { type: "string", description: "URL path of the intercepted request" },
    sourceIp: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    metadata: {
      type: "object",
      required: ["redacted"],
      properties: {
        redacted: { type: "boolean", description: "Must be true; signals PII was stripped before submission" },
        matchedRule: { type: "string" },
        auditLoggedLocally: { type: "boolean" },
      },
      additionalProperties: true,
    },
  },
};

export async function eventsRoute(app: FastifyInstance) {
  app.post("/v1/events", {
    schema: {
      tags: ["ingestion"],
      summary: "Submit a security event",
      description:
        "Accepts a redacted security event from an agent. Authentication requires a Bearer API key. When `HMAC_REQUIRED=true` the `x-rasp-signature` header must contain a valid HMAC-SHA256 signature over the raw request body. When `QUEUE_ENABLED=true`, persistence is async via Redis/BullMQ.",
      security: [{ bearerAuth: [] }],
      headers: {
        type: "object",
        properties: {
          "x-rasp-signature": {
            type: "string",
            description: "HMAC-SHA256 signature (required when HMAC_REQUIRED=true)",
          },
          "x-idempotency-key": {
            type: "string",
            description: "Optional idempotency key to deduplicate retries",
          },
        },
      },
      body: eventBodySchema,
      response: {
        202: {
          description: "Event accepted",
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            eventId: { type: "string" },
            queued: { type: "boolean" },
            duplicate: { type: "boolean" },
          },
        },
        400: { description: "Validation error", ...errorSchema },
        401: { description: "Missing or invalid API key / HMAC", ...errorSchema },
        403: { description: "projectId mismatch", ...errorSchema },
        413: { description: "Payload too large", ...errorSchema },
        429: { description: "Rate limit exceeded", ...errorSchema },
      },
    },
  }, async (req, reply) => {
    let auth: { projectId: string; apiKeyId: string };
    try {
      auth = await verifyApiKey(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(401).send({ error: err.message });
      }
      throw err;
    }

    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid payload",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const payload = parsed.data;

    const hmac = await enforceHmac(req, payload.agentId);
    if (!hmac.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return reply.status((hmac.status ?? 401) as any).send({ error: hmac.error });
    }

    if (!payload.metadata?.redacted) {
      return reply
        .status(400)
        .send({ error: "Events must be redacted before submission (metadata.redacted must be true)" });
    }

    if (payload.projectId !== auth.projectId) {
      return reply.status(403).send({ error: "projectId does not match API key" });
    }

    if (payload.agentId) {
      await trackVolume(auth.projectId, payload.agentId);
    }

    const idempotencyKey =
      (typeof req.headers["x-idempotency-key"] === "string"
        ? req.headers["x-idempotency-key"]
        : undefined) ??
      payload.eventId ??
      null;

    if (isQueueEnabled()) {
      const { jobId } = await enqueueEvent({
        payload,
        projectId: auth.projectId,
        idempotencyKey,
      });
      req.log.info(
        {
          jobId,
          projectId: auth.projectId,
          agentId: payload.agentId,
          eventType: payload.eventType,
          severity: payload.severity,
        },
        "event queued"
      );
      return reply.status(202).send({
        accepted: true,
        eventId: jobId,
        queued: true,
      });
    }

    const result = await persistEvent(payload, auth.projectId, idempotencyKey);

    req.log.info({
      eventId: result.eventId,
      projectId: auth.projectId,
      agentId: payload.agentId,
      eventType: payload.eventType,
      severity: payload.severity,
      path: payload.path,
      method: payload.method,
      alertCreated: result.alertCreated,
      duplicate: result.duplicate ?? false,
    }, "event accepted");

    return reply.status(202).send({
      accepted: true,
      eventId: result.eventId,
      queued: false,
      duplicate: result.duplicate ?? false,
    });
  });
}
