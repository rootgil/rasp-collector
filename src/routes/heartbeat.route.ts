import type { FastifyInstance } from "fastify";
import { HeartbeatSchema } from "../schemas/heartbeat.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { enforceHmac, assertAgentInProject } from "../modules/auth/verify-request.js";
import { persistHeartbeat } from "../modules/ingestion/persist-heartbeat.js";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

const heartbeatBodySchema = {
  type: "object",
  required: ["projectId", "agentId"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    agentVersion: { type: "string" },
    runtime: { type: "string" },
    framework: { type: "string" },
    status: { type: "string", enum: ["healthy", "degraded", "error"], default: "healthy" },
    mode: { type: "string", enum: ["monitor", "block"], default: "monitor" },
    timestamp: { type: "string", format: "date-time" },
  },
};

export async function heartbeatRoute(app: FastifyInstance) {
  app.post("/v1/heartbeat", {
    schema: {
      tags: ["ingestion"],
      summary: "Agent heartbeat",
      description:
        "Reports agent liveness, current status, and mode. Returns the current kill-switch state so the agent can self-disable immediately if needed.",
      security: [{ bearerAuth: [] }],
      headers: {
        type: "object",
        properties: {
          "x-rasp-signature": {
            type: "string",
            description: "HMAC-SHA256 signature (required when HMAC_REQUIRED=true)",
          },
        },
      },
      body: heartbeatBodySchema,
      response: {
        200: {
          description: "Heartbeat accepted",
          type: "object",
          properties: {
            agentId: { type: "string" },
            killSwitch: { type: "boolean" },
            mode: { type: "string" },
          },
        },
        400: { description: "Validation error", ...errorSchema },
        401: { description: "Missing or invalid API key / HMAC", ...errorSchema },
        403: { description: "projectId mismatch", ...errorSchema },
        404: { description: "Agent not registered", ...errorSchema },
        429: { description: "Rate limit exceeded", ...errorSchema },
      },
    },
  }, async (req, reply) => {
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

    const hmac = await enforceHmac(req, payload.agentId, auth.projectId);
    if (!hmac.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return reply.status((hmac.status ?? 401) as any).send({ error: hmac.error });
    }

    if (payload.projectId !== auth.projectId) {
      return reply.status(403).send({ error: "projectId does not match API key" });
    }

    let result;
    try {
      result = await persistHeartbeat(payload, auth.projectId);
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
