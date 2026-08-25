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
          password: config.get<string>('redis.password'),
          // Managed Redis (Upstash, Memorystore w/ in-transit encryption, etc.)
          // requires TLS on the standard port; local Docker Redis does not.
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
          // Some container network paths (observed on Cloud Run) resolve the
          // managed Redis hostname to an AAAA record with a broken IPv6 route,
          // which hangs the TCP handshake indefinitely instead of failing —
          // forcing IPv4 avoids that failure mode entirely.
          family: 4,
          // BullMQ's documented requirement for its Redis connections, so a
          // Worker's blocking commands don't get killed by ioredis's default
          // per-request retry cap.
          maxRetriesPerRequest: null,
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
