import { prisma } from "../../lib/prisma.js";
import type { HeartbeatPayload } from "../../schemas/heartbeat.schema.js";

export type HeartbeatResult = {
  ok: boolean;
  killSwitch: boolean;
  policyVersion: string;
};

/**
 * Compute a policyVersion string from the most recently updated ProjectRule (or
 * Rule) that is effectively active for the project. The agent uses this to detect
 * when its rule configuration has changed and should re-fetch the catalogue.
 *
 * Effective = Rule.enabled AND ProjectRule.enabled.
 * Falls back to "default" when the project has no active overrides.
 */
async function computePolicyVersion(projectId: string): Promise<string> {
  // Latest change among project-level overrides that are fully active
  const latestOverride = await prisma.projectRule.findFirst({
    where: {
      projectId,
      enabled: true,
      rule: { enabled: true },
    },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  if (latestOverride) {
    return `policy_${latestOverride.updatedAt.getTime()}`;
  }

  return "default";
}

export async function persistHeartbeat(
  payload: HeartbeatPayload
): Promise<HeartbeatResult> {
  const [agent, policyVersion] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: payload.agentId },
      select: { id: true, killSwitch: true },
    }),
    computePolicyVersion(payload.projectId),
  ]);

  if (!agent) {
    // Agent must be pre-registered via the dashboard before sending heartbeats.
    const err = new Error("Agent not registered") as Error & { code: string };
    err.code = "AGENT_NOT_FOUND";
    throw err;
  }

  await prisma.agent.update({
    where: { id: payload.agentId },
    data: {
      lastHeartbeatAt: new Date(),
      status: "online",
      version: payload.agentVersion ?? undefined,
      mode: payload.mode,
    },
  });

  return {
    ok: true,
    killSwitch: agent.killSwitch,
    policyVersion,
  };
}
