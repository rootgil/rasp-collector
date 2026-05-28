import { z } from "zod";

export const HeartbeatSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  agentVersion: z.string().optional(),
  runtime: z.string().optional(),
  framework: z.string().optional(),
  status: z.enum(["healthy", "degraded", "error"]).default("healthy"),
  mode: z.enum(["monitor", "block"]).default("monitor"),
  timestamp: z.string().datetime().optional(),
});

export type HeartbeatPayload = z.infer<typeof HeartbeatSchema>;
