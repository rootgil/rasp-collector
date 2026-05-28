import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { verifyHmac } from "../src/modules/auth/hmac.js";

// Mock prisma to avoid real DB connections
vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
    },
  },
}));

import { verifyApiKey, AuthError } from "../src/modules/auth/api-key.js";
import { prisma } from "../src/lib/prisma.js";

const mockFindMany = vi.mocked(prisma.apiKey.findMany);

describe("verifyApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws AuthError when Authorization header is missing", async () => {
    await expect(verifyApiKey(undefined)).rejects.toThrow(AuthError);
  });

  it("throws AuthError when Authorization header has wrong scheme", async () => {
    await expect(verifyApiKey("Basic dXNlcjpwYXNz")).rejects.toThrow(AuthError);
  });

  it("throws AuthError when no matching key found in DB", async () => {
    mockFindMany.mockResolvedValue([]);
    await expect(verifyApiKey("Bearer rasp_demo_badkey")).rejects.toThrow(AuthError);
  });

  it("throws AuthError when bcrypt compare fails", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "key1",
        projectId: "proj1",
        keyHash: "$2b$10$aaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        prefix: "rasp_demo",
        name: "test",
        revoked: false,
        createdAt: new Date(),
      },
    ]);
    await expect(verifyApiKey("Bearer rasp_demo_wrongvalue")).rejects.toThrow(AuthError);
  });
});

describe("verifyHmac", () => {
  it("returns false when signature header is missing", () => {
    const body = Buffer.from(JSON.stringify({ test: true }));
    expect(verifyHmac(body, undefined, "secret")).toBe(false);
  });

  it("returns false when signature has wrong algorithm prefix", () => {
    const body = Buffer.from("{}");
    expect(verifyHmac(body, "md5=abc123", "secret")).toBe(false);
  });

  it("returns false when digest is wrong", () => {
    const body = Buffer.from("{}");
    expect(verifyHmac(body, "sha256=" + "a".repeat(64), "secret")).toBe(false);
  });

  it("returns true for a valid HMAC-SHA256 signature", () => {
    const secret = "test-secret";
    const body = Buffer.from(JSON.stringify({ projectId: "proj1" }));
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmac(body, sig, secret)).toBe(true);
  });
});
