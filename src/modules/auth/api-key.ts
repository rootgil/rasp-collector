import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";

export type AuthResult = {
  projectId: string;
  apiKeyId: string;
};

/**
 * Extract and verify a Bearer API key from the Authorization header.
 * Prefix lookup matches the platform: `rawKey.slice(0, 12)`.
 */
export async function verifyApiKey(authHeader: string | undefined): Promise<AuthResult> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey || rawKey.length < 12) {
    throw new AuthError("Empty API key");
  }

  // Must match platform createApiKey: prefix = rawKey.slice(0, 12)
  const prefix = rawKey.slice(0, 12);

  const candidates = await prisma.apiKey.findMany({
    where: {
      prefix,
      revoked: false,
    },
    select: { id: true, keyHash: true, projectId: true },
    take: 5,
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
