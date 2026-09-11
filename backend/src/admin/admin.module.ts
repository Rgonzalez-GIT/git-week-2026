import { Module } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}