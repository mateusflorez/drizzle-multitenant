import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3002;
  await app.listen(port);

  console.log(`
========================================
  NestJS Multi-tenant API
========================================
  Server running on http://localhost:${port}

  Try these commands:

  # Create a user
  curl -X POST http://localhost:${port}/users \\
    -H "Content-Type: application/json" \\
    -H "X-Tenant-ID: acme" \\
    -d '{"email": "bob@acme.com", "name": "Bob", "role": "admin"}'

  # Create an order
  curl -X POST http://localhost:${port}/orders \\
    -H "Content-Type: application/json" \\
    -H "X-Tenant-ID: acme" \\
    -d '{"userId": "{user-id}", "items": [{"productName": "Widget", "quantity": 2, "price": 1999}]}'

  # List orders
  curl http://localhost:${port}/orders \\
    -H "X-Tenant-ID: acme"
========================================
  `);
}

bootstrap();
