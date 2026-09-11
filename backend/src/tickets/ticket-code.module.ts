import { Module } from '@nestjs/common';
import { TicketCodeService } from './ticket-code.service.js';

@Module({
  providers: [TicketCodeService],
  exports: [TicketCodeService],
})
export class TicketsModule {}