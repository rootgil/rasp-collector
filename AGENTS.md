# AGENTS.md — rasp-collector

This repository contains the RASP event collector.

## Scope

The collector is a standalone Fastify service that receives telemetry from RASP agents deployed in customer applications.

Responsibilities:
- authenticate agents via Bearer API key (bcrypt-verified)
- validate telemetry payloads with Zod
- enforce payload size limits (64 KB default)
- optionally verify payload integrity via HMAC-SHA256
- apply per-IP rate limits
- persist accepted events in PostgreSQL (shared DB with rasp-platform)
- auto-create alerts for high/critical events
- update agent heartbeat and expose kill-switch status
- expose health checks

## Architecture Rules

- Use Fastify 5 and TypeScript.
- Validate all inputs with Zod.
- Never trust agent payloads.
- Return 202 Accepted quickly after validation and persistence.
- Do not include dashboard, backoffice, or UI logic.
- Use structured Pino logs.
- Never log raw request bodies.
- Never log secrets or API keys.
- Business logic goes in `src/modules/`, not in route handlers.
- Route handlers only: parse, auth, validate, call module, respond.

## Security Rules

- Reject requests without a valid Bearer token.
- Reject revoked API keys.
- Reject unsigned payloads when `HMAC_REQUIRED=true`.
- Reject events without `metadata.redacted=true`.
- Reject oversized payloads (413).
- Return 429 when rate limit is exceeded.
- Never store raw API keys — compare with bcrypt only.
- Never log secrets (Authorization headers are redacted by Pino).
- Fail safely under overload — no data loss, no cascade crashes.

## File Structure

```
src/
├── server.ts                  # entrypoint, graceful shutdown
├── app.ts                     # Fastify app factory (helmet, rate-limit, routes)
├── config.ts                  # env parsing with Zod
├── routes/
│   ├── health.route.ts        # GET /health
│   ├── events.route.ts        # POST /v1/events
│   └── heartbeat.route.ts     # POST /v1/heartbeat
├── modules/
│   ├── auth/api-key.ts        # Bearer token verification
│   ├── auth/hmac.ts           # HMAC-SHA256 signature verification
│   ├── ingestion/persist-event.ts      # SecurityEvent + Alert persistence
│   └── ingestion/persist-heartbeat.ts  # Agent heartbeat update
├── schemas/
│   ├── event.schema.ts        # Zod schema for POST /v1/events
│   └── heartbeat.schema.ts    # Zod schema for POST /v1/heartbeat
└── lib/
    ├── prisma.ts              # Prisma client singleton (Neon adapter)
    └── logger.ts              # Pino logger instance
```
