import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { RequiresTenant } from "drizzle-multitenant/nestjs";
import { OrdersService } from "./orders.service";

interface CreateOrderDto {
  userId: string;
  notes?: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
}

@Controller("orders")
@RequiresTenant()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.ordersService.findOne(id);
  }

  @Get(":id/items")
  getItems(@Param("id") id: string) {
    return this.ordersService.getItems(id);
  }

  @Post()
  create(@Body() data: CreateOrderDto) {
    return this.ordersService.create(data);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string) {
    return this.ordersService.updateStatus(id, "completed");
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string) {
    return this.ordersService.updateStatus(id, "cancelled");
  }
}
