import { prisma } from "../../lib/prisma.js";
import type { DiscoveryPayload } from "../../schemas/discovery.schema.js";

export async function persistDiscovery(payload: DiscoveryPayload): Promise<number> {
  let accepted = 0;

  for (const ep of payload.endpoints) {
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
        hasSensitiveData: ep.hasSensitiveData,
        trafficCount: ep.observationCount,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        authStatus: ep.authStatus,
        hasSensitiveData: ep.hasSensitiveData,
        trafficCount: { increment: ep.observationCount },
        lastSeenAt: new Date(),
      },
    });
    accepted++;
  }

  return accepted;
}
