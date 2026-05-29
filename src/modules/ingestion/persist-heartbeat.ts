import { prisma } from "../../lib/prisma.js";
import type { HeartbeatPayload } from "../../schemas/heartbeat.schema.js";
import { computePolicyVersion, getLatestPolicy } from "./get-policy.js";
import { resolveTargetVersion } from "./resolve-target-version.js";

export type HeartbeatResult = {
  ok: boolean;
  killSwitch: boolean;
  policyVersion: string;
  mode: string;
  targetVersion: string | null;
  upgradeAvailable: boolean;
  changelog: string | null;
  impact: string | null;
};

export async function persistHeartbeat(
  payload: HeartbeatPayload
): Promise<HeartbeatResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: payload.agentId },
    select: {
      id: true,
      projectId: true,
      killSwitch: true,
      mode: true,
      channel: true,
      version: true,
      pinnedVersion: true,
      targetVersion: true,
      maintenanceWindow: true,
    },
  });

  if (!agent) {
    // Agent must be pre-registered via the dashboard before sending heartbeats.
    const err = new Error("Agent not registered") as Error & { code: string };
    err.code = "AGENT_NOT_FOUND";
    throw err;
  }

  // The real policy version is the latest published policy for this agent's
  // project + channel. When it changes the agent re-fetches GET /v1/policy.
  const reportedVersion = payload.agentVersion ?? agent.version;
  const [policyVersion, target, platform, latestPolicy] = await Promise.all([
    computePolicyVersion(agent.projectId, agent.channel),
    resolveTargetVersion({
      id: agent.id,
      channel: agent.channel,
      version: reportedVersion,
      pinnedVersion: agent.pinnedVersion,
      targetVersion: agent.targetVersion,
      maintenanceWindow: agent.maintenanceWindow,
    }),
    prisma.platformSetting.findUnique({
      where: { id: "global" },
      select: { killSwitch: true },
    }),
    getLatestPolicy(agent.projectId, agent.id, agent.channel),
  ]);

  // Global kill-switch overrides per-agent state during a platform-wide incident.
  const killSwitch = agent.killSwitch || platform?.killSwitch === true;

  await prisma.agent.update({
    where: { id: payload.agentId },
    data: {
      lastHeartbeatAt: new Date(),
      status: "online",
      version: payload.agentVersion ?? undefined,
      mode: payload.mode,
      // When the agent reports it now runs the target, mark the upgrade done.
      ...(payload.agentVersion && payload.agentVersion === agent.targetVersion
        ? { upgradeStatus: "succeeded", lastUpgradeAt: new Date() }
        : {}),
    },
  });

  return {
    ok: true,
    killSwitch,
    policyVersion,
    mode: latestPolicy?.mode ?? agent.mode,
    targetVersion: target.targetVersion,
    upgradeAvailable: target.upgradeAvailable,
    changelog: target.changelog,
    impact: target.impact,
  };
}
