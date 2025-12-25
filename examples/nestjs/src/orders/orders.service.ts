import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectTenantDb } from "drizzle-multitenant/nestjs";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../schema";

interface CreateOrderDto {
  userId: string;
  notes?: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectTenantDb()
    private readonly db: PostgresJsDatabase<typeof schema>
  ) {}

  async findAll() {
    return this.db.select().from(schema.orders);
  }

  async findOne(id: string) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));

    return { ...order, items };
  }

  async getItems(orderId: string) {
    return this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
  }

  async create(data: CreateOrderDto) {
    const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const [order] = await this.db
      .insert(schema.orders)
      .values({
        userId: data.userId,
        notes: data.notes,
        total,
        status: "pending",
      })
      .returning();

    if (data.items.length > 0) {
      await this.db.insert(schema.orderItems).values(
        data.items.map((item) => ({
          orderId: order.id,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
        }))
      );
    }

    return this.findOne(order.id);
  }

  async updateStatus(id: string, status: string) {
    const [order] = await this.db
      .update(schema.orders)
      .set({ status })
      .where(eq(schema.orders.id, id))
      .returning();

    if (!order) {
      throw new NotFoundException("Order not found");
    }
    return order;
  }
}
