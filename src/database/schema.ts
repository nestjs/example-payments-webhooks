import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['customer', 'staff'] }).notNull().default('customer'),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    // Money in integer cents: no floating-point rounding.
    price: integer('price').notNull(),
    stock: integer('stock').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('products_price_positive', sql`${table.price} > 0`),
    // The last line of defense against overselling.
    check('products_stock_not_negative', sql`${table.stock} >= 0`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.productId] })],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // placed, then paid and shipped, or cancelled.
    status: text('status', { enum: ['placed', 'paid', 'shipped', 'cancelled'] }).notNull(),
    total: integer('total').notNull(),
    // The provider's id for the payment, set when it succeeds.
    paymentId: text('payment_id'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('orders_user_id_created_at_idx').on(table.userId, table.createdAt)],
);

// What was bought, at the price it was bought at: later price changes don't rewrite past orders.
export const orderItems = pgTable(
  'order_items',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.productId] })],
);

// What @nestjs/authentication keeps for refresh tokens, stored by their SHA-256.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    // A family is revoked when any of its tokens is.
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_expires_at_idx').on(table.familyExpiresAt),
  ],
);

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
