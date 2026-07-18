import { z } from "zod";

/** Metadata keys accepted from agents — everything else is stripped. */
const METADATA_ALLOWLIST = new Set([
  "redacted",
  "matchedRule",
  "matchedRules",
  "matchedValueFingerprint",
  "matchedValueKind",
  "auditLoggedLocally",
  "detectorDescription",
  "location",
  "redactionVersion",
]);

function sanitizeMetadata(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!METADATA_ALLOWLIST.has(k)) continue;
    // Never persist raw matchedValue even if a buggy agent sends it.
    if (k === "matchedValue") continue;
    out[k] = v;
  }
  // Require explicit redacted flag; reject if missing/false at route layer.
  return out;
}

export const EventSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  agentVersion: z.string().optional(),
  runtime: z.string().optional(),
  framework: z.string().optional(),
  /** Optional client event id used as idempotency key when header is absent. */
  eventId: z.string().min(1).max(128).optional(),
  eventType: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  action: z.enum(["monitor", "block"]).default("monitor"),
  method: z.string().optional(),
  path: z.string().optional(),
  sourceIp: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  metadata: z
    .object({
      redacted: z.literal(true),
      matchedRule: z.string().optional(),
      matchedRules: z.unknown().optional(),
      matchedValueFingerprint: z.string().optional(),
      matchedValueKind: z.string().optional(),
      auditLoggedLocally: z.boolean().optional(),
      detectorDescription: z.string().optional(),
      location: z.string().optional(),
      redactionVersion: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional()
    .transform((m) => sanitizeMetadata(m as Record<string, unknown> | undefined)),
});

export type EventPayload = z.infer<typeof EventSchema>;
