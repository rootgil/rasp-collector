import type { FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../config.js";
import { verifyHmac } from "./hmac.js";

/**
 * Resolve the HMAC secret for a request: prefer the per-agent secret (Addendum
 * E.5), fall back to the global collector secret. Returns null if neither is
 * configured.
 */
async function resolveHmacSecret(agentId: string | undefined): Promise<string | null> {
  if (agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { hmacSecret: true },
    });
    if (agent?.hmacSecret) return agent.hmacSecret;
  }
  return config.hmacSecret ?? null;
}

export interface HmacOutcome {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Enforce HMAC payload integrity when enabled. The signature is verified over
 * the exact raw bytes the agent signed (captured by the content-type parser).
 *
 * @param agentId - From the parsed body; used to look up the per-agent secret.
 */
export async function enforceHmac(
  req: FastifyRequest,
  agentId: string | undefined
): Promise<HmacOutcome> {
  if (!config.hmacRequired) return { ok: true };

  const secret = await resolveHmacSecret(agentId);
  if (!secret) {
    req.log.error("HMAC_REQUIRED is true but no agent/global HMAC secret is set");
    return { ok: false, status: 500, error: "Server misconfiguration" };
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const signature = req.headers["x-rasp-signature"] as string | undefined;
  if (!rawBody || !verifyHmac(rawBody, signature, secret)) {
    return { ok: false, status: 401, error: "Invalid HMAC signature" };
  }
  return { ok: true };
}
