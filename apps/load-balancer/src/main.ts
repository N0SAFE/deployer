import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";
import { EnvService } from "./config/env/env.service";

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        snapshot: process.env.NODE_ENV !== "production",
    });

    const envService = app.get(EnvService);

    app.enableCors({
        origin: true,
        credentials: true,
    });

    const port = Number(envService.get("LOAD_BALANCER_PORT"));
    await app.listen(port);

    const logger = new Logger("LoadBalancerBootstrap");
    logger.log(`⚖️ Load balancer listening on port ${String(port)}`);
}

bootstrap().catch((error: unknown) => {
    const logger = new Logger("LoadBalancerBootstrap");
    logger.error("Failed to start load balancer", error);
    process.exit(1);
});