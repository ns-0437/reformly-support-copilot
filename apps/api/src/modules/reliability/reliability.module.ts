import { Module } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';

@Module({
  providers: [ReliabilityService],
  exports: [ReliabilityService],
})
export class ReliabilityModule {}
