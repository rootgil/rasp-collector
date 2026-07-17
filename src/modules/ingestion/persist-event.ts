import { prisma } from "../../lib/prisma.js";
import type { EventPayload } from "../../schemas/event.schema.js";
import { encryptForProject } from "../../lib/envelope.js";

const HIGH_SEVERITY = new Set(["critical", "high"]);

export type PersistEventResult = {
  eventId: string;
  alertCreated: boolean;
  duplicate?: boolean;
};

export async function persistEvent(
  payload: EventPayload,
  projectId: string,
  idempotencyKey?: string | null
): Promise<PersistEventResult> {
  const key = idempotencyKey?.trim() || payload.eventId?.trim() || null;

  if (key) {
    const existing = await prisma.securityEvent.findFirst({
      where: { projectId, idempotencyKey: key },
      select: { id: true },
    });
    if (existing) {
      return { eventId: existing.id, alertCreated: false, duplicate: true };
    }
  }

  const encryptedPayload = payload.metadata
    ? await encryptForProject(projectId, JSON.parse(JSON.stringify(payload.metadata)))
    : undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.securityEvent.create({
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
          payload: encryptedPayload as object | undefined,
          idempotencyKey: key,
        },
      });

      let alertCreated = false;
      if (HIGH_SEVERITY.has(payload.severity)) {
        await tx.alert.create({
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
    });

    return result;
  } catch (err) {
    // Concurrent duplicate insert on unique (projectId, idempotencyKey).
    if (key && isUniqueViolation(err)) {
      const existing = await prisma.securityEvent.findFirst({
        where: { projectId, idempotencyKey: key },
        select: { id: true },
      });
      if (existing) {
        return { eventId: existing.id, alertCreated: false, duplicate: true };
      }
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
