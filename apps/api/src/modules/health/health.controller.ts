import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../../prisma.service';

/**
 * Real dependency check, not a static 200 — a container that's "up" but
 * can't reach the database is not actually healthy, and Cloud Run's own TCP
 * probe wouldn't catch that.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res() res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.status(HttpStatus.OK).json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        db: 'unreachable',
        message: (err as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
