import { prisma } from "../../lib/prisma.js";
import type { DiscoveryPayload } from "../../schemas/discovery.schema.js";

/**
 * Risk score heuristic (0-100): unauthenticated + sensitive data + errors raise
 * the score. Used to sort the dashboard inventory.
 */
function computeRiskScore(opts: {
  authStatus: string;
  authObserved: boolean;
  hasSensitiveData: boolean;
  errorRate: number;
}): number {
  let score = 0;
  if (opts.authStatus !== "authenticated" && !opts.authObserved) score += 40;
  if (opts.hasSensitiveData) score += 35;
  score += Math.min(25, Math.round(opts.errorRate * 25));
  return Math.min(100, score);
}

export async function persistDiscovery(payload: DiscoveryPayload): Promise<number> {
  let accepted = 0;

  for (const ep of payload.endpoints) {
    const existing = await prisma.discoveredEndpoint.findUnique({
      where: {
        projectId_method_pathPattern: {
          projectId: payload.projectId,
          method: ep.method,
          pathPattern: ep.pathPattern,
        },
      },
    });

    const newTraffic = (existing?.trafficCount ?? 0) + ep.observationCount;
    const newErrors = (existing?.errorCount ?? 0) + (ep.errorCount ?? 0);
    const errorRate = newTraffic > 0 ? newErrors / newTraffic : 0;

    // Rolling average latency.
    let avgResponseMs = existing?.avgResponseMs ?? 0;
    if (ep.timedCount && ep.sumDurationMs !== undefined) {
      const batchAvg = ep.sumDurationMs / ep.timedCount;
      avgResponseMs =
        existing && existing.avgResponseMs > 0
          ? Math.round((existing.avgResponseMs + batchAvg) / 2)
          : Math.round(batchAvg);
    }

    // Authorization observation: middleware-confirmed beats header heuristic.
    const authorization = ep.authObserved ? "enforced" : existing?.authorization ?? "unknown";

    // Merge inferred schema fields.
    const mergedSchema = {
      ...((existing?.schema as Record<string, string> | null) ?? {}),
      ...(ep.schemaFields ?? {}),
    };

    const riskScore = computeRiskScore({
      authStatus: ep.authStatus,
      authObserved: ep.authObserved ?? false,
      hasSensitiveData: ep.hasSensitiveData,
      errorRate,
    });

    await prisma.discoveredEndpoint.upsert({
      where: {
        projectId_method_pathPattern: {
          projectId: payload.projectId,
          method: ep.method,
          pathPattern: ep.pathPattern,
        },
      },
      create: {
        projectId: payload.projectId,
        method: ep.method,
        pathPattern: ep.pathPattern,
        authStatus: ep.authStatus,
        authorization,
        hasSensitiveData: ep.hasSensitiveData,
        trafficCount: ep.observationCount,
        errorCount: ep.errorCount ?? 0,
        avgResponseMs,
        schema: mergedSchema,
        riskScore,
        // Spec drift (Addendum A.3): a freshly observed endpoint is a shadow API
        // until it is reconciled against an imported OpenAPI spec.
        isShadowApi: true,
        isZombieApi: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        authStatus: ep.authStatus,
        authorization,
        hasSensitiveData: ep.hasSensitiveData,
        trafficCount: newTraffic,
        errorCount: newErrors,
        avgResponseMs,
        schema: mergedSchema,
        riskScore,
        // Active traffic clears the zombie flag.
        isZombieApi: false,
        lastSeenAt: new Date(),
      },
    });
    accepted++;
  }

  return accepted;
}
