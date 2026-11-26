import { Module } from '@nestjs/common';
import { OrderPaidHandler } from './order-paid.handler.js';
import { OrderPolicy } from './order.policy.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrderPolicy, OrderPaidHandler],
  exports: [OrdersService],
})
export class OrdersModule {}
