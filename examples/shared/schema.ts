/**
 * Shared Drizzle schema used by all examples
 */
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

// Tenant schema - isolated per tenant
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  content: varchar("content", { length: 5000 }),
  authorId: uuid("author_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Shared schema - public, shared across all tenants
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  maxUsers: varchar("max_users", { length: 50 }),
  price: varchar("price", { length: 50 }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type Plan = typeof plans.$inferSelect;
