import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { PaymentsService } from './payments.service.js';

const orderId = { schema: z.uuid() };

@Controller('orders')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // The same order always gets the same payment, so this answers 200, new or not.
  @Can.Anyone()
  @Post(':id/payment')
  @HttpCode(200)
  start(@CurrentUser('id') userId: string, @Param('id', orderId) id: string) {
    return this.paymentsService.start(userId, id);
  }
}
