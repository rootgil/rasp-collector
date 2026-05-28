# rasp-collector

High-throughput RASP event collector for ingesting, authenticating, validating, rate-limiting, and persisting runtime security telemetry from agents.

Separate repos: `rasp-platform` (dashboard + backoffice) · `rasp-agent-node` (runtime agent) · `rasp-docs`

## Stack

- **Fastify 5** · TypeScript · Node.js 22
- **Prisma 7** · PostgreSQL (Neon) — shared DB with `rasp-platform`
- **Zod** · bcryptjs · @fastify/helmet · @fastify/rate-limit
- **Pino** structured logs (redacts secrets)
- **Vitest** unit tests

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Service health check |
| `POST` | `/v1/events` | Bearer API key | Ingest a security event |
| `POST` | `/v1/heartbeat` | Bearer API key | Agent heartbeat + kill-switch check |

## Quick start

### 1. Clone & install

```bash
git clone <repo>
cd rasp-collector
pnpm install
```

### 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env` — use the **same** `DATABASE_URL` as `rasp-platform`:

```
DATABASE_URL="postgresql://user:password@ep-xyz.region.aws.neon.tech/rasp_platform?sslmode=require"
```

### 3. Generate Prisma client

```bash
pnpm db:generate
```

No migration needed — schema is managed by `rasp-platform`.

### 4. Run

```bash
pnpm dev      # development with hot reload
pnpm start    # production (after pnpm build)
```

Collector listens on **http://0.0.0.0:4000**.

## Sending events

```bash
curl -X POST http://localhost:4000/v1/events \
  -H "Authorization: Bearer rasp_demo_key_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<your-project-id>",
    "agentId": "agent_001",
    "agentVersion": "0.1.0",
    "runtime": "node",
    "framework": "express",
    "eventType": "sql_injection",
    "severity": "high",
    "action": "monitor",
    "method": "GET",
    "path": "/api/users",
    "sourceIp": "hash_42",
    "metadata": {
      "redacted": true,
      "matchedRule": "SQLI_BASIC_001",
      "auditLoggedLocally": true
    }
  }'
```

Expected response (`202 Accepted`):

```json
{ "accepted": true, "eventId": "clxxx..." }
```

## Sending a heartbeat

```bash
curl -X POST http://localhost:4000/v1/heartbeat \
  -H "Authorization: Bearer rasp_demo_key_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<your-project-id>",
    "agentId": "agent_001",
    "agentVersion": "0.1.0",
    "runtime": "node",
    "framework": "express",
    "status": "healthy",
    "mode": "monitor"
  }'
```

Response includes `killSwitch` — if `true`, the agent must stop processing:

```json
{ "ok": true, "killSwitch": false, "policyVersion": "default" }
```

## Security model

- **Bearer API key** — bcrypt-verified against `ApiKey.keyHash` in Postgres; rejected if `revoked=true`
- **HMAC payload integrity** — optional (`HMAC_REQUIRED=true`) via `X-RASP-Signature: sha256=<digest>`
- **Rate limiting** — 600 req/min per IP by default (`RATE_LIMIT_PER_MINUTE`)
- **Payload size limit** — 64 KB max (`MAX_EVENT_SIZE_BYTES`)
- **Mandatory redaction** — events without `metadata.redacted=true` are rejected with 400
- **Structured logs** — Authorization headers and secrets are always redacted from logs
- **Auto-alert** — high/critical events automatically create an `Alert` record visible in `rasp-platform`

## Roadmap (production-grade)

- Redis + BullMQ queue for async processing and backpressure
- mTLS between agents and collector
- Certificate pinning
- Per-tenant rate limiting (currently per-IP)
- Dead-letter queue for failed events
- Prometheus metrics endpoint
- Horizontal scaling with shared Redis state

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to dist/ |
| `pnpm start` | Run compiled server |
| `pnpm test` | Run Vitest unit tests |
| `pnpm typecheck` | TypeScript type check |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:studio` | Open Prisma Studio |
