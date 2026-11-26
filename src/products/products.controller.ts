import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiSecurity } from '@nestjs/swagger';
import { z } from 'zod';
import { ProductPolicy } from './product.policy.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type CreateProductDto,
  type ListProductsQuery,
  type UpdateProductDto,
} from './products.schemas.js';
import { ProductsService } from './products.service.js';

const productId = { schema: z.uuid() };

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @ApiSecurity({})
  @Get()
  findAll(@Query({ schema: listProductsQuerySchema }) query: ListProductsQuery) {
    return this.productsService.findAll(query);
  }

  @Public()
  @ApiSecurity({})
  @Get(':id')
  findOne(@Param('id', productId) id: string) {
    return this.productsService.findOne(id);
  }

  @Can(ProductPolicy, 'manage')
  @Post()
  create(@Body({ schema: createProductSchema }) dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Can(ProductPolicy, 'manage')
  @Patch(':id')
  update(@Param('id', productId) id: string, @Body({ schema: updateProductSchema }) dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }
}
