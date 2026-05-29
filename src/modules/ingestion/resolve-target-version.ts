import { prisma } from "../../lib/prisma.js";

/** Stable 0-99 bucket for an agent id (FNV-1a). Mirrors the platform. */
function cohortBucket(agentId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

function isInCohort(agentId: string, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  return cohortBucket(agentId) < percent;
}

export interface TargetVersionResult {
  targetVersion: string | null;
  upgradeAvailable: boolean;
  changelog: string | null;
  impact: string | null;
}

interface MaintenanceWindow {
  startHour?: number;
  endHour?: number;
  days?: number[];
}

/** True if `now` (UTC) falls inside the maintenance window (always true if none). */
function inMaintenanceWindow(win: MaintenanceWindow | null, now = new Date()): boolean {
  if (!win) return true;
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  if (Array.isArray(win.days) && win.days.length > 0 && !win.days.includes(day)) {
    return false;
  }
  const start = typeof win.startHour === "number" ? win.startHour : 0;
  const end = typeof win.endHour === "number" ? win.endHour : 24;
  // Support windows that wrap past midnight (e.g. 22 -> 4).
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Resolve the version an agent should run, honouring (in priority order):
 *  1. Customer pin (Agent.pinnedVersion) - always wins.
 *  2. Canary cohort membership for the latest published version on the channel
 *     (skips halted/quarantined versions).
 *  3. Otherwise: stay on the current version.
 *
 * Persists targetVersion / previousVersion transitions on the Agent so the
 * platform can track and roll back.
 */
export async function resolveTargetVersion(agent: {
  id: string;
  channel: string;
  version: string;
  pinnedVersion: string | null;
  targetVersion: string | null;
  maintenanceWindow?: unknown;
}): Promise<TargetVersionResult> {
  const windowOpen = inMaintenanceWindow(
    (agent.maintenanceWindow as MaintenanceWindow | null) ?? null
  );

  // 1. Pin overrides everything.
  if (agent.pinnedVersion) {
    return {
      targetVersion: agent.pinnedVersion,
      upgradeAvailable: windowOpen && agent.pinnedVersion !== agent.version,
      changelog: null,
      impact: null,
    };
  }

  // 2. Latest healthy published version on the channel.
  const latest = await prisma.agentVersion.findFirst({
    where: {
      channel: agent.channel,
      status: "published",
      halted: false,
      quarantined: false,
    },
    orderBy: { releasedAt: "desc" },
  });

  if (!latest || latest.version === agent.version) {
    return { targetVersion: agent.version, upgradeAvailable: false, changelog: null, impact: null };
  }

  const inCohort = isInCohort(agent.id, latest.rolloutPercent);
  if (!inCohort || !windowOpen) {
    // Not in cohort, or upgrades paused outside the maintenance window.
    return {
      targetVersion: inCohort ? latest.version : agent.version,
      upgradeAvailable: false,
      changelog: inCohort ? latest.changelog : null,
      impact: inCohort ? latest.impact : null,
    };
  }

  // Agent is in the canary cohort for a newer version → advertise the upgrade
  // and record the transition for rollback bookkeeping.
  if (agent.targetVersion !== latest.version) {
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        targetVersion: latest.version,
        previousVersion: agent.version,
        upgradeStatus: "upgrading",
      },
    });
  }

  return {
    targetVersion: latest.version,
    upgradeAvailable: true,
    changelog: latest.changelog,
    impact: latest.impact,
  };
}
