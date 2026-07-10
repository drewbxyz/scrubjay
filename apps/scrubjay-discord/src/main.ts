import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { AppConfig } from "@/core/config/config.schema";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Creating the app validates the environment and loads .env.
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppConfig, true>);

  // Wire OS signals to Nest lifecycle hooks so the pg pool drains and Necord
  // destroys the Discord client on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Migrations must finish before the bot goes live; Necord login and
  // cron jobs only start on listen(). Use a dedicated pool and close it so
  // no orphaned connection outlives the migration.
  const migrationPool = new Pool({
    connectionString: config.get("DATABASE_URL", { infer: true }),
  });
  try {
    await migrate(drizzle(migrationPool), {
      migrationsFolder: join(process.cwd(), "src", "drizzle"),
    });
  } finally {
    await migrationPool.end();
  }

  await app.listen(config.get("PORT", { infer: true }));
}
bootstrap();
