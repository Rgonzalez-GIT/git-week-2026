import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AdminService } from './admin.service.js';
import { AssignTicketAdminDto, UpdateProductAdminDto, UpdatePromotionAdminDto } from './admin.dto.js';

/**
 * Fase 14 - Admin (solo rol ADMIN via JWT + RolesGuard).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @Roles('ADMIN')
  stats() {
    return this.adminService.stats();
  }

  @Get('users')
  @Roles('ADMIN')
  users() {
    return this.adminService.listUsers();
  }

  @Get('orders')
  @Roles('ADMIN')
  orders() {
    return this.adminService.listOrders();
  }

  @Get('promotions')
  @Roles('ADMIN')
  promotions() {
    return this.adminService.listPromotions();
  }

  @Patch('products/:id')
  @Roles('ADMIN')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductAdminDto) {
    return this.adminService.updateProduct(id, dto);
  }

  @Patch('promotions/:id')
  @Roles('ADMIN')
  updatePromotion(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePromotionAdminDto) {
    return this.adminService.updatePromotion(id, dto);
  }

  @Get('tickets')
  @Roles('ADMIN')
  tickets() {
    return this.adminService.listTickets();
  }

  @Patch('tickets/:code')
  @Roles('ADMIN')
  assignTicket(@Param('code') code: string, @Body() dto: AssignTicketAdminDto) {
    return this.adminService.assignTicket(code, dto);
  }
}