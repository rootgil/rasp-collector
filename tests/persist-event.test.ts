import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    securityEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    alert: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/lib/envelope.js", () => ({
  encryptForProject: vi.fn(async (_projectId: string, data: unknown) => data),
}));

import { prisma } from "../src/lib/prisma.js";
import { persistEvent } from "../src/modules/ingestion/persist-event.js";

describe("persistEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates event and alert atomically for high severity", async () => {
    const tx = {
      securityEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-1" }),
      },
      alert: {
        create: vi.fn().mockResolvedValue({ id: "alert-1" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)(tx)
    );

    const result = await persistEvent(
      {
        projectId: "proj-1",
        eventType: "sql-injection",
        severity: "critical",
        action: "monitor",
        metadata: { redacted: true },
      },
      "proj-1",
      "idem-1"
    );

    expect(result.eventId).toBe("evt-1");
    expect(result.alertCreated).toBe(true);
    expect(tx.securityEvent.create).toHaveBeenCalled();
    expect(tx.alert.create).toHaveBeenCalled();
  });

  it("returns duplicate when idempotency key exists", async () => {
    vi.mocked(prisma.securityEvent.findFirst).mockResolvedValue({ id: "evt-existing" } as never);

    const result = await persistEvent(
      {
        projectId: "proj-1",
        eventType: "xss",
        severity: "low",
        action: "monitor",
        metadata: { redacted: true },
      },
      "proj-1",
      "same-key"
    );

    expect(result.duplicate).toBe(true);
    expect(result.eventId).toBe("evt-existing");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
