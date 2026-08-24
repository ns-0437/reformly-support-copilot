import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveEscalationDto {
  @IsIn(['approve', 'edit', 'reject'])
  action!: 'approve' | 'edit' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  finalResponse?: string;

  @IsEmail()
  reviewedBy!: string;
}
