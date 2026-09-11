import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/ticket-code.module.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [TicketsModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}