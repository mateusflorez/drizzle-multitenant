import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectTenantDb } from "drizzle-multitenant/nestjs";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../schema";

@Injectable()
export class UsersService {
  constructor(
    @InjectTenantDb()
    private readonly db: PostgresJsDatabase<typeof schema>
  ) {}

  async findAll() {
    return this.db.select().from(schema.users);
  }

  async findOne(id: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  async create(data: { email: string; name: string; role?: string }) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        email: data.email,
        name: data.name,
        role: data.role || "user",
      })
      .returning();

    return user;
  }

  async update(id: string, data: { name?: string; role?: string; active?: boolean }) {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  async remove(id: string) {
    const [user] = await this.db
      .delete(schema.users)
      .where(eq(schema.users.id, id))
      .returning();

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return { deleted: true };
  }
}
