import type { FastifyInstance } from "fastify";
import { DiscoveryPayloadSchema } from "../schemas/discovery.schema.js";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { enforceHmac } from "../modules/auth/verify-request.js";
import { persistDiscovery } from "../modules/ingestion/persist-discovery.js";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

const discoveryBodySchema = {
  type: "object",
  required: ["projectId", "agentId", "endpoints"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    timestamp: { type: "string", format: "date-time" },
    endpoints: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      items: {
        type: "object",
        required: ["method", "pathPattern", "observationCount"],
        properties: {
          method: { type: "string", minLength: 1, maxLength: 16, description: "HTTP method (uppercased)" },
          pathPattern: { type: "string", minLength: 1, maxLength: 2048 },
          authStatus: { type: "string", enum: ["authenticated", "unauthenticated", "unknown"], default: "unknown" },
          hasSensitiveData: { type: "boolean", default: false },
          observationCount: { type: "integer", minimum: 1 },
          authObserved: { type: "boolean" },
          errorCount: { type: "integer", minimum: 0 },
          sumDurationMs: { type: "number", minimum: 0 },
          timedCount: { type: "integer", minimum: 0 },
          schemaFields: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
      },
    },
  },
};

export async function discoveryRoute(app: FastifyInstance) {
  app.post("/v1/discovery", {
    schema: {
      tags: ["ingestion"],
      summary: "Submit API endpoint discovery batch",
      description:
        "Submits a batch of observed API endpoints from an agent. Up to 500 entries per request. Used to build the API inventory and detect shadow APIs.",
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
      body: discoveryBodySchema,
      response: {
        202: {
          description: "Batch accepted",
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            count: { type: "integer", description: "Number of endpoints upserted" },
          },
        },
        400: { description: "Validation error", ...errorSchema },
        401: { description: "Missing or invalid API key / HMAC", ...errorSchema },
        403: { description: "projectId mismatch", ...errorSchema },
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
    const parsed = DiscoveryPayloadSchema.safeParse(req.body);
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
