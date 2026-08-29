import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { InboundWebhookDto } from './dto/inbound-webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('shopify')
  shopify(@Body() body: InboundWebhookDto) {
    return this.webhooks.handle({
      provider: 'shopify',
      externalEventId: body.eventId,
      eventType: body.eventType,
      payload: body.data,
    });
  }

  @Post('stripe')
  stripe(@Body() body: InboundWebhookDto) {
    return this.webhooks.handle({
      provider: 'stripe',
      externalEventId: body.eventId,
      eventType: body.eventType,
      payload: body.data,
    });
  }
}
