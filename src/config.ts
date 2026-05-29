import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MAX_EVENT_SIZE_BYTES: z.coerce.number().default(65536),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(600),
  ABNORMAL_VOLUME_PER_MINUTE: z.coerce.number().default(300),
  HMAC_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HMAC_SECRET: z.string().optional(),
  MTLS_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Comma-separated SHA-256 fingerprints of allowed agent client certificates.
  MTLS_ALLOWED_FINGERPRINTS: z.string().optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  host: env.HOST,
  nodeEnv: env.NODE_ENV,
  isDev: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",
  databaseUrl: env.DATABASE_URL,
  maxEventSizeBytes: env.MAX_EVENT_SIZE_BYTES,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  abnormalVolumePerMinute: env.ABNORMAL_VOLUME_PER_MINUTE,
  hmacRequired: env.HMAC_REQUIRED,
  hmacSecret: env.HMAC_SECRET,
  mtlsRequired: env.MTLS_REQUIRED,
  mtlsAllowedFingerprints: (env.MTLS_ALLOWED_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().replace(/:/g, "").toLowerCase())
    .filter(Boolean),
  logLevel: env.LOG_LEVEL,
} as const;
