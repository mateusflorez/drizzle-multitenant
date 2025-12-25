/**
 * Drizzle schema for NestJS example
 */
import { pgTable, uuid, varchar, timestamp, boolean, integer, text } from "drizzle-orm/pg-core";

// Tenant-specific tables
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).default("user"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  status: varchar("status", { length: 50 }).default("pending"),
  total: integer("total").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  productName: varchar("product_name", { length: 255 }).notNull(),
  quantity: integer("quantity").default(1),
  price: integer("price").default(0),
});

// Shared tables (public schema)
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  maxUsers: integer("max_users"),
  price: integer("price"),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Plan = typeof plans.$inferSelect;
