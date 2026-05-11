import { NestFactory } from "@nestjs/core";
import { AppModule } from "./mesh-test.module";
import { logger } from "@repo/logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    snapshot: process.env.NODE_ENV !== "production",
    bodyParser: false, // Disable NestJS body parser for oRPC
  });

  app.useLogger(["log", "error", "warn", "debug", "verbose"]);
  const port = process.env.API_PORT ?? 3005;
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  logger.error("Failed to start the application", { error });
  process.exit(1);
});
