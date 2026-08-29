import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBasicAuth, ApiTags } from '@nestjs/swagger';
import { ObservabilityService } from './observability.service';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('analytics')
@ApiBasicAuth()
@Controller('analytics')
@UseGuards(AdminAuthGuard)
export class ObservabilityController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get('summary')
  summary() {
    return this.observability.summary();
  }
}
