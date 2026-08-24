import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';

@Controller('escalations')
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
