import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBasicAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EscalationService } from './escalation.service';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';
import { AdminAuthGuard, AuthenticatedAdminRequest } from '../../common/guards/admin-auth.guard';

@ApiTags('escalations')
@ApiBasicAuth()
@Controller('escalations')
@UseGuards(AdminAuthGuard)
export class EscalationController {
  constructor(private readonly escalations: EscalationService) {}

  @Get()
  @ApiQuery({ name: 'limit', required: false, description: 'Max items to return (default 50, capped at 100)' })
  list(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.escalations.listPending(limit);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() body: ResolveEscalationDto, @Req() req: AuthenticatedAdminRequest) {
    return this.escalations.resolve(id, { ...body, reviewedBy: req.adminUser });
  }
}
