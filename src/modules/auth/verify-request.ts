import type { FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../config.js";
import { verifyHmac } from "./hmac.js";

/**
 * Resolve the HMAC secret for a request: prefer the per-agent secret when the
 * agent belongs to `projectId`, else fall back to the global collector secret.
 */
async function resolveHmacSecret(
  agentId: string | undefined,
  projectId: string
): Promise<string | null> {
  if (agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, projectId },
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
 */
export async function enforceHmac(
  req: FastifyRequest,
  agentId: string | undefined,
  projectId: string
): Promise<HmacOutcome> {
  if (!config.hmacRequired) return { ok: true };

  const secret = await resolveHmacSecret(agentId, projectId);
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

/**
 * Ensure agentId (when present) belongs to the authenticated project.
 */
export async function assertAgentInProject(
  agentId: string | undefined,
  projectId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!agentId) return { ok: true };
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, projectId },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, status: 404, error: "Agent not found for this project" };
  }
  return { ok: true };
}
