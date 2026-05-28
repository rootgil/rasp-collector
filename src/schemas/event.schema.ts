import { z } from "zod";

export const EventSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  agentVersion: z.string().optional(),
  runtime: z.string().optional(),
  framework: z.string().optional(),
  eventType: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  action: z.enum(["monitor", "block"]).default("monitor"),
  method: z.string().optional(),
  path: z.string().optional(),
  sourceIp: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  metadata: z
    .object({
      redacted: z.boolean(),
      matchedRule: z.string().optional(),
      auditLoggedLocally: z.boolean().optional(),
    })
    .and(z.record(z.string(), z.unknown()))
    .optional(),
});

export type EventPayload = z.infer<typeof EventSchema>;
