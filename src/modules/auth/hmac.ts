import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify the X-RASP-Signature header against the raw request body.
 * Signature format: sha256=<hex-digest>
 */
export function verifyHmac(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const [algo, digest] = signatureHeader.split("=");
  if (algo !== "sha256" || !digest) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
