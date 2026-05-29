import type { FastifyInstance } from "fastify";
import { verifyApiKey, AuthError } from "../modules/auth/api-key.js";
import { getLatestPolicy } from "../modules/ingestion/get-policy.js";

/**
 * GET /v1/policy
 *
 * Serves the latest signed policy for the authenticated project. The collector
 * is a relay only: it returns the control-plane-signed payload verbatim so the
 * agent can verify the Ed25519 signature before applying it.
 *
 * Query params:
 *  - agentId (optional): used to resolve the agent's channel if `channel` omitted
 *  - channel (optional): stable | early | edge
 */
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
};

export async function policyRoute(app: FastifyInstance) {
  app.get("/v1/policy", {
    schema: {
      tags: ["ingestion"],
      summary: "Fetch latest signed policy",
      description:
        "Returns the latest control-plane-signed policy for the authenticated project and channel. The agent must verify the Ed25519 signature before applying the policy.",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Used to resolve the agent channel when `channel` is omitted" },
          channel: { type: "string", enum: ["stable", "early", "edge"], description: "Policy channel" },
        },
      },
      response: {
        200: {
          description: "Signed policy payload",
          type: "object",
          additionalProperties: true,
        },
        401: { description: "Missing or invalid API key", ...errorSchema },
        404: { description: "No policy published for this project/channel", ...errorSchema },
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

    const q = req.query as { agentId?: string; channel?: string };
    const policy = await getLatestPolicy(auth.projectId, q.agentId, q.channel);

    if (!policy) {
      return reply.status(404).send({ error: "No policy published for this project/channel" });
    }

    return reply.send(policy);
  });
}
