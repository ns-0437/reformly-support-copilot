import { Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { InboundWebhookDto } from './dto/inbound-webhook.dto';
import { verifyShopifySignature, verifyStripeSignature } from './webhook-signature.util';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Post('shopify')
  shopify(
    @Body() body: InboundWebhookDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') signature?: string,
  ) {
    const secret = this.config.get<string>('webhooks.shopifySecret');
    if (!secret) {
      throw new UnauthorizedException('Shopify webhook verification is not configured on this deployment');
    }
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
  stripe(
    @Body() body: InboundWebhookDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const secret = this.config.get<string>('webhooks.stripeSecret');
    if (!secret) {
      throw new UnauthorizedException('Stripe webhook verification is not configured on this deployment');
    }
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
