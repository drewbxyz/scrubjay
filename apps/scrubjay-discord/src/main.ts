import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { AppConfig } from "@/core/config/config.schema";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Creating the app validates the environment and loads .env.
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppConfig, true>);

  // Migrations must finish before the bot goes live; Necord login and
  // cron jobs only start on listen().
  const db = drizzle(config.get("DATABASE_URL", { infer: true }));
  await migrate(db, {
    migrationsFolder: join(process.cwd(), "src", "drizzle"),
  });

  await app.listen(config.get("PORT", { infer: true }));
}
bootstrap();
