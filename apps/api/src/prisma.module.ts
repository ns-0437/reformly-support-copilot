import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global so every feature module can inject PrismaService without each one
 * declaring it as a local provider — that would spin up a separate
 * PrismaClient (and connection pool) per module, which is wasteful and,
 * worse, means transactions in one module can't see writes made via another
 * module's client until they've both flushed.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
