import { prisma } from "../../lib/prisma.js";
import { config } from "../../config.js";

/**
 * Abnormal volume detection (Addendum E.5).
 *
 * Tracks per-agent (and per-project) ingestion rate in an in-memory sliding
 * window. When an agent exceeds the threshold it raises a single Alert per
 * cool-down period so a compromised or misbehaving agent flooding the collector
 * is surfaced without spamming alerts.
 */
interface Counter {
  windowStart: number;
  count: number;
  lastAlertAt: number;
}

const WINDOW_MS = 60_000;
const ALERT_COOLDOWN_MS = 5 * 60_000;

const counters = new Map<string, Counter>();

export async function trackVolume(projectId: string, agentId: string): Promise<void> {
  const threshold = config.abnormalVolumePerMinute;
  if (threshold <= 0) return;

  const now = Date.now();
  const key = `${projectId}:${agentId}`;
  let c = counters.get(key);
  if (!c || now - c.windowStart > WINDOW_MS) {
    c = { windowStart: now, count: 0, lastAlertAt: c?.lastAlertAt ?? 0 };
    counters.set(key, c);
  }
  c.count++;

  if (c.count > threshold && now - c.lastAlertAt > ALERT_COOLDOWN_MS) {
    c.lastAlertAt = now;
    try {
      const event = await prisma.securityEvent.create({
        data: {
          projectId,
          agentId,
          type: "abnormal_volume",
          severity: "high",
          redacted: true,
          action: "monitor",
          payload: {
            reason: "abnormal_telemetry_volume",
            count: c.count,
            threshold,
            windowMs: WINDOW_MS,
          },
        },
      });
      await prisma.alert.create({
        data: {
          projectId,
          securityEventId: event.id,
          severity: "high",
          status: "open",
        },
      });
    } catch {
      // Never let alerting break ingestion.
    }
  }
}

/** Drop stale counters (bounded memory). Call periodically if desired. */
export function pruneVolumeCounters(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [k, c] of counters) {
    if (c.windowStart < cutoff && Date.now() - c.lastAlertAt > ALERT_COOLDOWN_MS) {
      counters.delete(k);
    }
  }
}
