import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('message')
  send(@Body() dto: SendMessageDto) {
    return this.chat.handleMessage(dto);
  }

  @Get('conversations/:id')
  get(@Param('id') id: string) {
    return this.chat.getConversation(id);
  }
}
