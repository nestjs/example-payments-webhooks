import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { setQuantitySchema, type SetQuantityDto } from './cart.schemas.js';
import { CartService } from './cart.service.js';

const productId = { schema: z.uuid() };

// Every signed-in customer has a cart, and only sees their own.
@Can.Anyone()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  get(@CurrentUser('id') userId: string) {
    return this.cartService.get(userId);
  }

  @Put('items/:productId')
  setQuantity(
    @CurrentUser('id') userId: string,
    @Param('productId', productId) id: string,
    @Body({ schema: setQuantitySchema }) { quantity }: SetQuantityDto,
  ) {
    return this.cartService.setQuantity(userId, id, quantity);
  }

  @Delete('items/:productId')
  remove(@CurrentUser('id') userId: string, @Param('productId', productId) id: string) {
    return this.cartService.remove(userId, id);
  }
}
