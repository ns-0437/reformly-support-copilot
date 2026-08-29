import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail()
  customerEmail!: string;

  @ApiPropertyOptional({ description: 'Omit to start a new conversation; pass an existing id to continue one.' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ example: 'Whats the status of order RFM-10234?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
