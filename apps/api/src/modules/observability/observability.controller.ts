import { Controller, Get } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

@Controller('analytics')
export class ObservabilityController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get('summary')
  summary() {
    return this.observability.summary();
  }
}
