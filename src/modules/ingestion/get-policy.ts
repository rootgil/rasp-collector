import { prisma } from "../../lib/prisma.js";

export interface DistributedPolicy {
  version: number;
  channel: string;
  mode: string;
  detectionRules: unknown;
  redactionConfig: unknown;
  dataResidency: unknown;
  targetAgentVersion: string | null;
  signature: string;
  signingKeyId: string | null;
}

/**
 * Resolve the latest signed policy for a project on a given channel.
 *
 * The collector is a pure relay: it never signs and never mutates the policy.
 * It returns exactly what the control plane stored so the agent can verify the
 * signature itself. If `channel` is omitted, the agent's registered channel is
 * used.
 */
export async function getLatestPolicy(
  projectId: string,
  agentId?: string,
  channel?: string
): Promise<DistributedPolicy | null> {
  let resolvedChannel = channel;
  if (!resolvedChannel && agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, projectId },
      select: { channel: true },
    });
    resolvedChannel = agent?.channel ?? undefined;
  }

  const policy = await prisma.policy.findFirst({
    where: {
      projectId,
      ...(resolvedChannel ? { channel: resolvedChannel } : {}),
    },
    orderBy: { version: "desc" },
  });

  if (!policy) return null;

  return {
    version: policy.version,
    channel: policy.channel,
    mode: policy.mode,
    detectionRules: policy.detectionRules ?? null,
    redactionConfig: policy.redactionConfig ?? null,
    dataResidency: policy.dataResidency ?? null,
    targetAgentVersion: policy.targetAgentVersion ?? null,
    signature: policy.signature,
    signingKeyId: policy.signingKeyId ?? null,
  };
}

/**
 * Compute the current policy version string for a project/channel, used in the
 * heartbeat response so the agent knows when to re-fetch.
 */
export async function computePolicyVersion(
  projectId: string,
  channel: string
): Promise<string> {
  const latest = await prisma.policy.findFirst({
    where: { projectId, channel },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return latest ? String(latest.version) : "0";
}
