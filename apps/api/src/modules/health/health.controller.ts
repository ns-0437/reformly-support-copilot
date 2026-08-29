import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../prisma.service';

/**
 * Real dependency check, not a static 200 — a container that's "up" but
 * can't reach the database is not actually healthy, and Cloud Run's own TCP
 * probe wouldn't catch that.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle() // uptime monitors/probes hit this frequently by design
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res() res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.status(HttpStatus.OK).json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      // Logged internally for debugging, but never returned in the response —
      // this is a public, unauthenticated endpoint and a raw DB error message
      // can leak internal connection details to anyone who requests it.
      this.logger.error(`Health check failed: ${(err as Error).message}`);
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        db: 'unreachable',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
