import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cloud Run can run up to maxScale separate instances, each opening its own
 * Prisma connection pool against the same Postgres instance. Without an
 * explicit connection_limit on DATABASE_URL, Prisma's default pool size is
 * derived from the container's visible CPU count rather than anything aware
 * of how many *other* instances might be doing the same thing — at this
 * deployment's current maxScale, the untuned default sits right at (and can
 * exceed) Supabase's connection ceiling.
 */
export function hasConnectionLimit(databaseUrl: string): boolean {
  return /[?&]connection_limit=/.test(databaseUrl);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();

    // Won't catch every misconfiguration, but turns a silent capacity cliff
    // into a visible one at boot instead.
    const url = process.env.DATABASE_URL ?? '';
    if (url && !hasConnectionLimit(url)) {
      this.logger.warn(
        'DATABASE_URL has no connection_limit param. Under autoscaling, each instance opens its own pool at Prisma\'s default size, which can collectively exceed the database\'s max connections. Add ?connection_limit=<n> to DATABASE_URL.',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
