import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { OrderPolicy } from './order.policy.js';
import { OrdersService } from './orders.service.js';

const orderId = { schema: z.uuid() };

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Checkout: the cart becomes an order.
  @Can.Anyone()
  @Post()
  checkout(@CurrentUser('id') userId: string) {
    return this.ordersService.checkout(userId);
  }

  @Can.Anyone()
  @Get()
  findMine(@CurrentUser('id') userId: string) {
    return this.ordersService.findMine(userId);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id', orderId) id: string) {
    return this.ordersService.findOne(userId, id);
  }

  @Can.Anyone()
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser('id') userId: string, @Param('id', orderId) id: string) {
    return this.ordersService.cancel(userId, id);
  }

  @Can(OrderPolicy, 'ship')
  @Post(':id/ship')
  @HttpCode(200)
  ship(@Param('id', orderId) id: string) {
    return this.ordersService.ship(id);
  }
}
