import { prisma } from "../../lib/prisma.js";
import type { HeartbeatPayload } from "../../schemas/heartbeat.schema.js";

export type HeartbeatResult = {
  ok: boolean;
  killSwitch: boolean;
  policyVersion: string;
  mode: string;
};

/**
 * Rules are managed globally by the platform admin and enforced via hardcoded
 * detectors in the agent. No per-project overrides exist, so policyVersion is
 * always "default".
 */
function computePolicyVersion(): string {
  return "default";
}

export async function persistHeartbeat(
  payload: HeartbeatPayload
): Promise<HeartbeatResult> {
  const [agent, policyVersion] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: payload.agentId },
      select: { id: true, killSwitch: true, mode: true },
    }),
    Promise.resolve(computePolicyVersion()),
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
    mode: agent.mode,
  };
}
