import { z } from "zod";

export const DiscoveryEntrySchema = z.object({
  method: z.string().min(1).max(16).toUpperCase(),
  pathPattern: z.string().min(1).max(2048),
  authStatus: z.enum(["authenticated", "unauthenticated", "unknown"]).default("unknown"),
  hasSensitiveData: z.boolean().default(false),
  observationCount: z.number().int().min(1),
  authObserved: z.boolean().optional(),
  errorCount: z.number().int().min(0).optional(),
  sumDurationMs: z.number().min(0).optional(),
  timedCount: z.number().int().min(0).optional(),
  schemaFields: z.record(z.string(), z.string()).optional(),
  sensitiveFields: z.array(z.string()).optional(),
});

export const DiscoveryPayloadSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  endpoints: z.array(DiscoveryEntrySchema).min(1).max(500),
});

export type DiscoveryEntry = z.infer<typeof DiscoveryEntrySchema>;
export type DiscoveryPayload = z.infer<typeof DiscoveryPayloadSchema>;
