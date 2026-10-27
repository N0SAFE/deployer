import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * oRPC parses its own bodies, so the Nest body parser is disabled. That also
 * lets Better Auth's Node handler (mounted by `AuthModule`) read the raw
 * stream for `/api/auth/*`.
 */
export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.enableCors({ origin: true, credentials: true });

  return app;
}
