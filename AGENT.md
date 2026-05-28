# AGENTS.md — rasp-collector

This repository contains the RASP event collector.

## Scope

The collector receives telemetry from RASP agents.

Responsibilities:
- authenticate agents
- validate telemetry payloads
- enforce payload size limits
- verify payload integrity
- apply per-agent and per-tenant rate limits
- normalize events
- enqueue events for asynchronous processing
- persist accepted events
- expose health checks

## Architecture Rules

- Use Fastify and TypeScript.
- Validate all inputs with Zod.
- Never trust agent payloads.
- Keep ingestion fast.
- Return quickly after validation and queueing.
- Do not include dashboard or backoffice logic.
- Do not include UI code.
- Do not perform heavy analytics in request handlers.
- Use structured logs.
- Never log raw request bodies.

## Security Rules

- Reject unsigned or invalid payloads when HMAC is required.
- Enforce rate limiting.
- Reject events that are not marked as redacted.
- Reject oversized payloads.
- Never log raw secrets.
- Never store raw API keys.
- Fail safely under overload.
- Return 202 for accepted events.