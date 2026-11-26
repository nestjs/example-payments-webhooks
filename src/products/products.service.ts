import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, ilike } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { products, type Product } from '../database/schema.js';
import type { CreateProductDto, ListProductsQuery, UpdateProductDto } from './products.schemas.js';

@Injectable()
export class ProductsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  findAll({ q, limit, offset }: ListProductsQuery): Promise<Product[]> {
    return this.db
      .select()
      .from(products)
      .where(and(eq(products.active, true), q ? ilike(products.name, `%${escapeLike(q)}%`) : undefined))
      .orderBy(asc(products.name), asc(products.id))
      .limit(limit)
      .offset(offset);
  }

  async findOne(id: string): Promise<Product> {
    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.active, true)));
    return product ?? notFound();
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const [product] = await this.db.insert(products).values(dto).returning();
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const [product] = await this.db.update(products).set(dto).where(eq(products.id, id)).returning();
    return product ?? notFound();
  }
}

function notFound(): never {
  throw new NotFoundException('Product not found');
}

/** `%` and `_` in the search are literal characters, not wildcards. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
