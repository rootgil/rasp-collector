import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";

export type AuthResult = {
  projectId: string;
  apiKeyId: string;
};

/**
 * Extract and verify a Bearer API key from the Authorization header.
 * Returns the matched project ID on success, throws on failure.
 */
export async function verifyApiKey(authHeader: string | undefined): Promise<AuthResult> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    throw new AuthError("Empty API key");
  }

  // Extract prefix (everything up to the last underscore segment that is the key body)
  // Seed format: "rasp_demo_key_abc123" — prefix is stored as "rasp_demo"
  const prefixMatch = rawKey.match(/^([a-z_]+)/);
  if (!prefixMatch) {
    throw new AuthError("Invalid API key format");
  }
  const prefix = prefixMatch[1].replace(/_$/, "");

  const candidates = await prisma.apiKey.findMany({
    where: {
      prefix: { startsWith: prefix },
      revoked: false,
    },
    select: { id: true, keyHash: true, projectId: true },
  });

  for (const candidate of candidates) {
    const match = await bcrypt.compare(rawKey, candidate.keyHash);
    if (match) {
      return { projectId: candidate.projectId, apiKeyId: candidate.id };
    }
  }

  throw new AuthError("Invalid or revoked API key");
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
