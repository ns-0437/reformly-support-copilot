import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// reviewedBy is deliberately not a field here. It used to be client-supplied
// free text — meaning whoever was authenticated as the shared admin account
// could claim any identity in the audit trail. It's now derived from the
// Basic Auth username that actually authenticated the request instead
// (see EscalationController), the only identity this endpoint can trust.
export class ResolveEscalationDto {
  @ApiProperty({ enum: ['approve', 'edit', 'reject'], description: 'approve sends the AI draft as-is, edit sends finalResponse instead, reject discards the draft entirely.' })
  @IsIn(['approve', 'edit', 'reject'])
  action!: 'approve' | 'edit' | 'reject';

  @ApiPropertyOptional({ description: 'Required when action is "edit" — the human-written replacement for the AI draft.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  finalResponse?: string;
}
