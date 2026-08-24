import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

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
