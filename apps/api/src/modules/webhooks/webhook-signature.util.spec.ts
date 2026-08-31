import * as crypto from 'crypto';
import { verifyShopifySignature, verifyStripeSignature } from './webhook-signature.util';

describe('webhook signature verification', () => {
  const secret = 'test-shared-secret';
  const body = Buffer.from(JSON.stringify({ eventId: 'evt_1', eventType: 'order.status_changed', data: { orderExternalId: 'RFM-1', status: 'shipped' } }));

  describe('verifyShopifySignature', () => {
    it('accepts a signature computed the same way Shopify computes it', () => {
      const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
      expect(verifyShopifySignature(body, signature, secret)).toBe(true);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const signature = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('base64');
      expect(verifyShopifySignature(body, signature, secret)).toBe(false);
    });

    it('rejects a signature that does not match a tampered body', () => {
      const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
      const tamperedBody = Buffer.from(body.toString('utf8').replace('shipped', 'refunded'));
      expect(verifyShopifySignature(tamperedBody, signature, secret)).toBe(false);
    });

    it('rejects a missing signature header outright', () => {
      expect(verifyShopifySignature(body, undefined, secret)).toBe(false);
    });
  });

  describe('verifyStripeSignature', () => {
    function sign(payload: Buffer, timestamp: number, withSecret = secret) {
      const signedPayload = `${timestamp}.${payload.toString('utf8')}`;
      const sig = crypto.createHmac('sha256', withSecret).update(signedPayload).digest('hex');
      return `t=${timestamp},v1=${sig}`;
    }

    it('accepts a signature computed the same way Stripe computes it', () => {
      const header = sign(body, Math.floor(Date.now() / 1000));
      expect(verifyStripeSignature(body, header, secret)).toBe(true);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const header = sign(body, Math.floor(Date.now() / 1000), 'wrong-secret');
      expect(verifyStripeSignature(body, header, secret)).toBe(false);
    });

    it('rejects a timestamp outside the replay tolerance window', () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
      const header = sign(body, staleTimestamp);
      expect(verifyStripeSignature(body, header, secret, 300)).toBe(false);
    });

    it('rejects a malformed header with no v1 signature', () => {
      expect(verifyStripeSignature(body, `t=${Math.floor(Date.now() / 1000)}`, secret)).toBe(false);
    });

    it('rejects a missing signature header outright', () => {
      expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
    });
  });
});
