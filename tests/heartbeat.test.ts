import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    apiKey: { findMany: vi.fn() },
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

vi.mock("../src/modules/ingestion/persist-heartbeat.js", () => ({
  persistHeartbeat: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { verifyApiKey, AuthError } from "../src/modules/auth/api-key.js";
import { persistHeartbeat } from "../src/modules/ingestion/persist-heartbeat.js";
import type { FastifyInstance } from "fastify";

const mockVerifyApiKey = vi.mocked(verifyApiKey);
const mockPersistHeartbeat = vi.mocked(persistHeartbeat);

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
});

const validHeartbeat = {
  projectId: "proj_123",
  agentId: "agent_001",
  agentVersion: "0.1.0",
  runtime: "node",
  framework: "express",
  status: "healthy",
  mode: "monitor",
};

describe("POST /v1/heartbeat", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockVerifyApiKey.mockRejectedValue(new AuthError("Missing or invalid Authorization header"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      payload: validHeartbeat,
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when payload is invalid", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: { projectId: "proj_123" }, // missing agentId
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with killSwitch false for a healthy agent", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });
    mockPersistHeartbeat.mockResolvedValue({
      ok: true,
      killSwitch: false,
      policyVersion: "default",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: validHeartbeat,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.killSwitch).toBe(false);
    expect(body.policyVersion).toBe("default");
  });

  it("returns killSwitch true when agent is disabled", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_123", apiKeyId: "key1" });
    mockPersistHeartbeat.mockResolvedValue({
      ok: true,
      killSwitch: true,
      policyVersion: "default",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: validHeartbeat,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().killSwitch).toBe(true);
  });

  it("returns 403 when projectId does not match API key", async () => {
    mockVerifyApiKey.mockResolvedValue({ projectId: "proj_OTHER", apiKeyId: "key1" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: { authorization: "Bearer rasp_demo_key" },
      payload: validHeartbeat,
    });

    expect(res.statusCode).toBe(403);
  });
});
