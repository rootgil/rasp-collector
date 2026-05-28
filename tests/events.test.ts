import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock DB and auth so tests run without a real Postgres connection
vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    securityEvent: { create: vi.fn() },
    alert: { create: vi.fn() },
    apiKey: { findMany: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    $disconnect: vi.fn(),
  },
}));

vi.mock("../src/modules/auth/api-key.js", () => ({
  verifyApiKey: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthError";
    }
  },
}));

vi.mock("../src/modules/ingestion/persist-event.js", () => ({
  persistEvent: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { verifyApiKey, AuthError } from "../src/modules/auth/api-key.js";
import { persistEvent } from "../src/modules/ingestion/persist-event.js";
import type { FastifyInstance } from "fastify";

const mockVerifyApiKey = vi.mocked(verifyApiKey);
const mockPersistEvent = vi.mocked(persistEvent);

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
});

const validPayload = {
  projectId: "proj_123",
  agentId: "agent_001",
  agentVersion: "0.1.0",
  runtime: "node",
  framework: "express",
  eventType: "sql_injection",
  severity: "high",
  action: "monitor",
  method: "GET",
  path: "/api/users",
  sourceIp: "hash_42",
  metadata: {
    redacted: true,
    matchedRule: "SQLI_BASIC_001",
    auditLoggedLocally: true,
  },
};

describe("POST /v1/events", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockVerifyApiKey.mockRejectedValue(new AuthError("Missing or invalid Authorization header"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toMatch(/authorization/i);
  });

  it("returns 401 when API key is revoked or invalid", async () => {
    mockVerifyApiKey.mockRejectedValue(new AuthError("Invalid or revoked API key"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_bad_key" },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when payload fails Zod validation", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: { projectId: "proj_123" }, // missing required fields
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Invalid payload");
  });

  it("returns 400 when metadata.redacted is not true", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: {
        ...validPayload,
        metadata: { redacted: false },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/redacted/i);
  });

  it("returns 403 when projectId does not match the API key's project", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_OTHER", apiKeyId: "key1" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: validPayload, // projectId: proj_123 ≠ proj_OTHER
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 413 when payload exceeds body limit", async () => {
    // Body limit is 65536 bytes by default
    const hugePayload = "x".repeat(70_000);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: {
        authorization: "Bearer rasp_demo_key",
        "content-type": "text/plain",
      },
      payload: hugePayload,
    });

    expect(res.statusCode).toBe(413);
  });

  it("returns 202 and eventId for a valid event", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });
    mockPersistEvent.mockResolvedValue({ eventId: "evt_abc123", alertCreated: false });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.eventId).toBe("evt_abc123");
  });

  it("creates an alert for critical severity events", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });
    mockPersistEvent.mockResolvedValue({ eventId: "evt_crit001", alertCreated: true });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: { ...validPayload, severity: "critical" },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().eventId).toBe("evt_crit001");
    expect(mockPersistEvent).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" }),
      "proj_123"
    );
  });
});
