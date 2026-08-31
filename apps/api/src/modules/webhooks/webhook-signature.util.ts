import * as crypto from 'crypto';

/**
 * Nothing here trusts the request body until the signature checks out —
 * WebhooksService's idempotency guard only protects against a *legitimate*
 * event being delivered twice. Without this, anyone who finds the endpoint
 * URL can POST a fabricated "order refunded" or "subscription cancelled"
 * event and have it applied as if it came from the real provider.
 */

/**
 * Shopify signs the raw body with HMAC-SHA256 and sends the base64 digest in
 * the X-Shopify-Hmac-Sha256 header.
 */
export function verifyShopifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return timingSafeEqualStrings(expected, signatureHeader);
}

/**
 * Stripe sends `t=<unix-seconds>,v1=<hex-hmac>[,v1=<hex-hmac>...]` in the
 * Stripe-Signature header. The HMAC is computed over `${timestamp}.${rawBody}`
 * — including the timestamp is what lets us also reject old/replayed
 * deliveries, not just forged ones.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  const timestamp = parts['t'];
  const signatures = signatureHeader
    .split(',')
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  return signatures.some((sig) => timingSafeEqualStrings(expected, sig));
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
