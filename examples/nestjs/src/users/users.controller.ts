import { Controller, Get, Post, Put, Delete, Param, Body } from "@nestjs/common";
import { RequiresTenant } from "drizzle-multitenant/nestjs";
import { UsersService } from "./users.service";

@Controller("users")
@RequiresTenant()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() data: { email: string; name: string; role?: string }) {
    return this.usersService.create(data);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() data: { name?: string; role?: string; active?: boolean }) {
    return this.usersService.update(id, data);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
