import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Transaction } from '../database/drizzle.js';
import { cartItems, orderItems, orders, products, type Order, type OrderItem } from '../database/schema.js';
import type { Payment } from '../payments/payment.js';

export type OrderWithItems = Order & { items: Omit<OrderItem, 'orderId'>[] };

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly outbox: Outbox<Transaction>,
  ) {}

  /** Turns the user's cart into an order, or throws without changing anything. */
  checkout(userId: string): Promise<OrderWithItems> {
    return this.db.transaction(async (tx) => {
      // Taking the cart is the first statement. A second checkout of the same
      // cart waits for this transaction, then finds it empty.
      const taken = await tx.delete(cartItems).where(eq(cartItems.userId, userId)).returning();
      if (taken.length === 0) {
        throw new ConflictException('Your cart is empty');
      }
      // Lock products in one order across all checkouts, so two of them never deadlock.
      taken.sort((a, b) => a.productId.localeCompare(b.productId));

      const items: Omit<OrderItem, 'orderId'>[] = [];
      for (const { productId, quantity } of taken) {
        // Checks and takes the stock in one statement: no read-then-write window.
        const [product] = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${quantity}` })
          .where(and(eq(products.id, productId), eq(products.active, true), gte(products.stock, quantity)))
          .returning({ name: products.name, price: products.price });
        if (!product) {
          // Rolls back the whole transaction: the cart and the other products are untouched.
          throw new ConflictException(`Not enough stock for product ${productId}`);
        }
        items.push({ productId, name: product.name, unitPrice: product.price, quantity });
      }

      const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const [order] = await tx.insert(orders).values({ userId, status: 'placed', total }).returning();
      await tx.insert(orderItems).values(items.map((item) => ({ ...item, orderId: order.id })));
      return { ...order, items };
    });
  }

  findMine(userId: string): Promise<Order[]> {
    return this.db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(100);
  }

  async findOne(userId: string, id: string): Promise<OrderWithItems> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)));
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return { ...order, items: await this.items(this.db, order.id) };
  }

  /** The owner cancels an order that isn't paid yet, and its stock goes back. */
  cancel(userId: string, id: string): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const order = await this.cancelPlaced(tx, and(eq(orders.id, id), eq(orders.userId, userId)));
      return order ?? this.refuse(tx, id, userId);
    });
  }

  /** The provider confirmed the payment. Runs in the webhook's transaction. */
  async markPaid(tx: Transaction, payment: Payment): Promise<Order | undefined> {
    // Conditional: only a placed order, for the amount it totals, becomes paid.
    // A replayed event, or one for a cancelled order, changes nothing.
    const [order] = await tx
      .update(orders)
      .set({ status: 'paid', paymentId: payment.id })
      .where(and(eq(orders.id, payment.reference), eq(orders.status, 'placed'), eq(orders.total, payment.amount)))
      .returning();
    if (!order) {
      await this.explainUnpaid(tx, payment);
      return undefined;
    }
    // Commits with the new status, or not at all: nothing hears of a payment that rolled back.
    await this.outbox.add(tx, {
      topic: 'order.paid',
      key: order.id,
      payload: { orderId: order.id, userId: order.userId, total: order.total, paymentId: payment.id },
    });
    return order;
  }

  /** The provider says the payment failed: the order is cancelled and its stock goes back. */
  cancelUnpaid(tx: Transaction, orderId: string): Promise<Order | undefined> {
    return this.cancelPlaced(tx, eq(orders.id, orderId));
  }

  /** Staff ship a paid order. */
  async ship(id: string): Promise<Order> {
    const [order] = await this.db
      .update(orders)
      .set({ status: 'shipped' })
      .where(and(eq(orders.id, id), eq(orders.status, 'paid')))
      .returning();
    return order ?? this.refuse(this.db, id);
  }

  /** Cancels the order if it's still placed, and puts its stock back, in the caller's transaction. */
  private async cancelPlaced(tx: Transaction, where: SQL | undefined): Promise<Order | undefined> {
    // Conditional: of a cancel and a payment racing for the same order, one wins.
    const [order] = await tx
      .update(orders)
      .set({ status: 'cancelled' })
      .where(and(where, eq(orders.status, 'placed')))
      .returning();
    if (!order) {
      return undefined;
    }
    for (const { productId, quantity } of await this.items(tx, order.id)) {
      await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${quantity}` })
        .where(eq(products.id, productId));
    }
    return order;
  }

  /** Logs why a payment changed nothing, unless it's a second event for the same payment. */
  private async explainUnpaid(tx: Transaction, payment: Payment): Promise<void> {
    const [order] = await tx
      .select({ status: orders.status, total: orders.total, paymentId: orders.paymentId })
      .from(orders)
      .where(eq(orders.id, payment.reference));
    if (order?.paymentId === payment.id) {
      return;
    }
    // A payment for a cancelled order, or for the wrong amount: the money has to go back.
    this.logger.warn(
      `Payment ${payment.id} of ${payment.amount} for order ${payment.reference} changed nothing ` +
        `(order ${order ? `${order.status}, total ${order.total}` : 'not found'}): refund it`,
    );
  }

  private items(db: Pick<NodePgDatabase, 'select'>, orderId: string) {
    return db
      .select({
        productId: orderItems.productId,
        name: orderItems.name,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.name));
  }

  /** Why a conditional update changed nothing: 404 if the order isn't there (or isn't theirs), 409 otherwise. */
  private async refuse(db: Pick<NodePgDatabase, 'select'>, id: string, userId?: string): Promise<never> {
    const [order] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, id), userId ? eq(orders.userId, userId) : undefined));
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    throw new ConflictException(`Order is ${order.status}`);
  }
}
