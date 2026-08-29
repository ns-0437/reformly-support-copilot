import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveEscalationDto {
  @ApiProperty({ enum: ['approve', 'edit', 'reject'], description: 'approve sends the AI draft as-is, edit sends finalResponse instead, reject discards the draft entirely.' })
  @IsIn(['approve', 'edit', 'reject'])
  action!: 'approve' | 'edit' | 'reject';

  @ApiPropertyOptional({ description: 'Required when action is "edit" — the human-written replacement for the AI draft.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  finalResponse?: string;

  @ApiProperty({ example: 'agent@reformly.com', description: 'Identity of whoever resolved this, for the audit trail.' })
  @IsEmail()
  reviewedBy!: string;
}
