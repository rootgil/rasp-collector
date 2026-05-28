import { prisma } from "../../lib/prisma.js";
import type { EventPayload } from "../../schemas/event.schema.js";

const HIGH_SEVERITY = new Set(["critical", "high"]);

export type PersistEventResult = {
  eventId: string;
  alertCreated: boolean;
};

export async function persistEvent(
  payload: EventPayload,
  projectId: string
): Promise<PersistEventResult> {
  const event = await prisma.securityEvent.create({
    data: {
      projectId,
      agentId: payload.agentId ?? null,
      type: payload.eventType,
      severity: payload.severity,
      method: payload.method ?? null,
      path: payload.path ?? null,
      sourceIp: payload.sourceIp ?? null,
      redacted: true,
      action: payload.action,
      payload: payload.metadata
        ? JSON.parse(JSON.stringify(payload.metadata))
        : undefined,
    },
  });

  let alertCreated = false;

  if (HIGH_SEVERITY.has(payload.severity)) {
    await prisma.alert.create({
      data: {
        projectId,
        securityEventId: event.id,
        severity: payload.severity,
        status: "open",
      },
    });
    alertCreated = true;
  }

  return { eventId: event.id, alertCreated };
}
