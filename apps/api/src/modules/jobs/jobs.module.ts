import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProvidersModule } from '../tools/providers/providers.module';
import { QUEUE_NAMES } from './queue.constants';
import { RefundProcessor } from './processors/refund.processor';
import { RefundQueueProducer } from './refund-queue.producer';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.REFUND_PROCESSING }),
    ProvidersModule,
  ],
  providers: [RefundProcessor, RefundQueueProducer],
  exports: [RefundQueueProducer],
})
export class JobsModule {}
