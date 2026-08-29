import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBasicAuth, ApiTags } from '@nestjs/swagger';
import { EscalationService } from './escalation.service';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('escalations')
@ApiBasicAuth()
@Controller('escalations')
@UseGuards(AdminAuthGuard)
export class EscalationController {
  constructor(private readonly escalations: EscalationService) {}

  @Get()
  list() {
    return this.escalations.listPending();
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() body: ResolveEscalationDto) {
    return this.escalations.resolve(id, body);
  }
}
