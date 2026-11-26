import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { cartItems, products } from '../database/schema.js';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  /** Whether checkout can take this line right now. */
  available: boolean;
}

export interface Cart {
  items: CartLine[];
  /** In cents, at today's prices. */
  total: number;
}

@Injectable()
export class CartService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async get(userId: string): Promise<Cart> {
    const rows = await this.db
      .select({
        productId: cartItems.productId,
        name: products.name,
        unitPrice: products.price,
        quantity: cartItems.quantity,
        active: products.active,
        stock: products.stock,
      })
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.userId, userId))
      .orderBy(asc(products.name));
    const items = rows.map(({ active, stock, ...line }) => ({ ...line, available: active && stock >= line.quantity }));
    const total = items.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    return { items, total };
  }

  async setQuantity(userId: string, productId: string, quantity: number): Promise<Cart> {
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.active, true)));
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    // Stock isn't reserved here: checkout checks it, in the same statement that takes it.
    await this.db
      .insert(cartItems)
      .values({ userId, productId, quantity })
      .onConflictDoUpdate({ target: [cartItems.userId, cartItems.productId], set: { quantity } });
    return this.get(userId);
  }

  async remove(userId: string, productId: string): Promise<Cart> {
    await this.db.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
    return this.get(userId);
  }
}
