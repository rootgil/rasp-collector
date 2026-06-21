/**
 * Envelope encryption for per-tenant payload-at-rest protection (Addendum E.6).
 *
 * Two-tier key hierarchy:
 *  - **KEK (master key)**: a single 32-byte key from `KEK_MASTER_KEY` (base64).
 *    It only ever wraps/unwraps DEKs; it never touches payloads directly.
 *  - **DEK (data key)**: a per-tenant (per-project) 32-byte key, generated on
 *    first use, stored *wrapped* by the KEK in {@link TenantKey}. Payloads are
 *    encrypted with the DEK using AES-256-GCM.
 *
 * Tenant deletion is crypto-shredding: destroying the wrapped DEK
 * ({@link destroyProjectKeys}) makes every payload for that tenant permanently
 * unrecoverable, even though the ciphertext rows remain.
 *
 * If `KEK_MASTER_KEY` is not configured (e.g. local dev), encryption is a
 * no-op passthrough so the collector still works; see README bootstrap.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

const ALGO = "aes-256-gcm";

export interface Envelope {
  _enc: true;
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

function masterKey(): Buffer | null {
  const b64 = process.env.KEK_MASTER_KEY;
  if (!b64) return null;
  try {
    const key = Buffer.from(b64, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function aesEncrypt(key: Buffer, plaintext: Buffer): { iv: string; tag: string; ct: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), tag: tag.toString("base64"), ct: ct.toString("base64") };
}

function aesDecrypt(key: Buffer, iv: string, tag: string, ct: string): Buffer {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
}

// In-memory cache of unwrapped DEKs keyed by `${projectId}:${version}`.
const dekCache = new Map<string, Buffer>();

function wrapDek(dek: Buffer, kek: Buffer): string {
  const { iv, tag, ct } = aesEncrypt(kek, dek);
  return [iv, tag, ct].join(".");
}

function unwrapDek(wrapped: string, kek: Buffer): Buffer {
  const [iv, tag, ct] = wrapped.split(".");
  return aesDecrypt(kek, iv!, tag!, ct!);
}

/** Get (or create) the active DEK for a project. Returns null if KEK absent. */
async function getActiveDek(projectId: string): Promise<{ version: number; dek: Buffer } | null> {
  const kek = masterKey();
  if (!kek) return null;

  const key = await prisma.tenantKey.findFirst({
    where: { projectId, active: true, destroyed: false },
  });

  if (!key) {
    const dek = randomBytes(32);
    await prisma.tenantKey.create({
      data: { projectId, version: 1, wrappedDek: wrapDek(dek, kek), active: true },
    });
    dekCache.set(`${projectId}:1`, dek);
    return { version: 1, dek };
  }

  const cacheKey = `${projectId}:${key.version}`;
  let dek = dekCache.get(cacheKey);
  if (!dek) {
    if (!key.wrappedDek) return null; // crypto-shredded
    dek = unwrapDek(key.wrappedDek, kek);
    dekCache.set(cacheKey, dek);
  }
  return { version: key.version, dek };
}

async function getDekByVersion(projectId: string, version: number): Promise<Buffer | null> {
  const kek = masterKey();
  if (!kek) return null;
  const cacheKey = `${projectId}:${version}`;
  const cached = dekCache.get(cacheKey);
  if (cached) return cached;
  const key = await prisma.tenantKey.findUnique({
    where: { projectId_version: { projectId, version } },
  });
  if (!key || !key.wrappedDek) return null;
  const dek = unwrapDek(key.wrappedDek, kek);
  dekCache.set(cacheKey, dek);
  return dek;
}

/**
 * Encrypt an arbitrary JSON value for a project. Returns an {@link Envelope}
 * when a KEK is configured, otherwise returns the value unchanged (dev).
 */
export async function encryptForProject(projectId: string, value: unknown): Promise<unknown> {
  if (value === null || value === undefined) return value;
  const active = await getActiveDek(projectId);
  if (!active) return value;
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const { iv, tag, ct } = aesEncrypt(active.dek, plaintext);
  const env: Envelope = { _enc: true, v: active.version, iv, tag, ct };
  return env;
}

export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)._enc === true
  );
}

/** Decrypt an {@link Envelope}; returns null if the key was destroyed. */
export async function decryptForProject(projectId: string, value: unknown): Promise<unknown> {
  if (!isEnvelope(value)) return value;
  const dek = await getDekByVersion(projectId, value.v);
  if (!dek) return null;
  try {
    const pt = aesDecrypt(dek, value.iv, value.tag, value.ct);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    return null;
  }
}
