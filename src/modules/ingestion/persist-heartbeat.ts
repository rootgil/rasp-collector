import { prisma } from "../../lib/prisma.js";
import type { HeartbeatPayload } from "../../schemas/heartbeat.schema.js";

export type HeartbeatResult = {
  ok: boolean;
  killSwitch: boolean;
  policyVersion: string;
};

export async function persistHeartbeat(
  payload: HeartbeatPayload
): Promise<HeartbeatResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: payload.agentId },
    select: { id: true, killSwitch: true },
  });

  if (!agent) {
    // Register the agent if it doesn't exist yet (auto-registration on first heartbeat)
    await prisma.agent.create({
      data: {
        id: payload.agentId,
        projectId: payload.projectId,
        language: payload.runtime ?? "unknown",
        framework: payload.framework ?? null,
        version: payload.agentVersion ?? "unknown",
        status: "online",
        mode: payload.mode,
        lastHeartbeatAt: new Date(),
      },
    });

    return { ok: true, killSwitch: false, policyVersion: "default" };
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
    policyVersion: "default",
  };
}
