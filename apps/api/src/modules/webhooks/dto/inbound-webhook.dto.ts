import { IsObject, IsString } from 'class-validator';

export class InboundWebhookDto {
  @IsString()
  eventId!: string;

  @IsString()
  eventType!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
