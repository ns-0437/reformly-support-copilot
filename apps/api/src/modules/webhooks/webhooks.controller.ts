import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { InboundWebhookDto } from './dto/inbound-webhook.dto';
import { verifyShopifySignature, verifyStripeSignature } from './webhook-signature.util';

/** A header can legally repeat, which Express then hands back as an array — take the first value defensively. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Post('shopify')
  @ApiOperation({
    summary: 'Inbound Shopify event',
    description: 'Requires a valid HMAC-SHA256 signature over the raw request body, base64-encoded, in X-Shopify-Hmac-Sha256 — matching how Shopify itself signs webhook deliveries.',
  })
  // Read straight off @Req() rather than a separate @Headers() param decorator —
  // @nestjs/swagger auto-documents @Headers() usage too, which duplicated this
  // entry in /docs (once auto-inferred, once from this @ApiHeader).
  @ApiHeader({ name: 'X-Shopify-Hmac-Sha256', description: 'HMAC-SHA256(rawBody, SHOPIFY_WEBHOOK_SECRET), base64-encoded', required: true })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid signature, or SHOPIFY_WEBHOOK_SECRET is not configured on this deployment' })
  shopify(@Body() body: InboundWebhookDto, @Req() req: RawBodyRequest<Request>) {
    const secret = this.config.get<string>('webhooks.shopifySecret');
    if (!secret) {
      throw new UnauthorizedException('Shopify webhook verification is not configured on this deployment');
    }
    const signature = singleHeader(req.headers['x-shopify-hmac-sha256']);
    if (!req.rawBody || !verifyShopifySignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid Shopify webhook signature');
    }

    return this.webhooks.handle({
      provider: 'shopify',
      externalEventId: body.eventId,
      eventType: body.eventType,
      payload: body.data,
    });
  }

  @Post('stripe')
  @ApiOperation({
    summary: 'Inbound Stripe event',
    description: 'Requires a valid Stripe-Signature header (t=<timestamp>,v1=<hmac>) — signatures older than 5 minutes are rejected as a replay, matching Stripe\'s own webhook signing scheme.',
  })
  @ApiHeader({ name: 'Stripe-Signature', description: 't=<unix-seconds>,v1=<hex HMAC-SHA256 of "timestamp.rawBody">', required: true })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid/expired signature, or STRIPE_WEBHOOK_SECRET is not configured on this deployment' })
  stripe(@Body() body: InboundWebhookDto, @Req() req: RawBodyRequest<Request>) {
    const secret = this.config.get<string>('webhooks.stripeSecret');
    if (!secret) {
      throw new UnauthorizedException('Stripe webhook verification is not configured on this deployment');
    }
    const signature = singleHeader(req.headers['stripe-signature']);
    if (!req.rawBody || !verifyStripeSignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    return this.webhooks.handle({
      provider: 'stripe',
      externalEventId: body.eventId,
      eventType: body.eventType,
      payload: body.data,
    });
  }
}
