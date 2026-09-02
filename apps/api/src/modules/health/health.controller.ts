import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../prisma.service';
import { RefundQueueProducer } from '../jobs/refund-queue.producer';

/**
 * Real dependency checks, not a static 200 — a container that's "up" but
 * can't reach Postgres or Redis isn't actually healthy, and Cloud Run's own
 * TCP probe wouldn't catch either. Redis specifically because a broken
 * connection there is exactly what caused a real incident once already
 * (see docs/CASE-STUDY.md) with zero signal from a naive health check.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle() // uptime monitors/probes hit this frequently by design
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refundQueue: RefundQueueProducer,
  ) {}

  @Get()
  async check(@Res() res: Response) {
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.refundQueue.ping(),
    ]);

    const dbOk = db.status === 'fulfilled';
    const redisOk = redis.status === 'fulfilled' && redis.value === true;

    if (db.status === 'rejected') this.logger.error(`Health check: Postgres unreachable: ${(db.reason as Error).message}`);
    if (redis.status === 'rejected') this.logger.error(`Health check: Redis unreachable: ${(redis.reason as Error).message}`);

    // Logged internally above, but never returned in the response — this is
    // a public, unauthenticated endpoint and a raw error message can leak
    // internal connection details to anyone who requests it.
    const body = {
      status: dbOk && redisOk ? 'ok' : 'error',
      db: dbOk ? 'ok' : 'unreachable',
      redis: redisOk ? 'ok' : 'unreachable',
      timestamp: new Date().toISOString(),
    };

    res.status(dbOk && redisOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(body);
  }
}
