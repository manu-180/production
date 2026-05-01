import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validate a GitHub webhook signature (X-Hub-Signature-256).
 *
 * GitHub computes: `sha256=hex(HMAC-SHA256(secret, rawBody))`
 * We replicate the computation and compare using timingSafeEqual to
 * prevent timing-oracle attacks on the secret.
 *
 * @param payload   Raw request body as a string (must NOT be parsed JSON).
 * @param signature Value of the X-Hub-Signature-256 header.
 * @param secret    The HMAC secret stored in webhook_endpoints.secret.
 * @returns         true if the signature is valid, false otherwise.
 */
export async function validateGitHubSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) {
    return false;
  }

  const receivedHex = signature.slice(prefix.length);

  const computed = createHmac("sha256", secret).update(payload).digest("hex");

  // Both buffers must be the same length for timingSafeEqual.
  // If they differ in length, the signature is wrong — return false
  // without leaking timing info about *how* wrong.
  if (receivedHex.length !== computed.length) {
    return false;
  }

  const receivedBuf = Buffer.from(receivedHex, "hex");
  const computedBuf = Buffer.from(computed, "hex");

  // Guard against empty / invalid hex that would produce zero-length buffers
  // on both sides and trivially pass the equal check.
  if (computedBuf.length === 0) {
    return false;
  }

  return timingSafeEqual(receivedBuf, computedBuf);
}
