import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { EnvModule } from "./config/env/env.module";
import { LoadBalancerModule } from "./modules/load-balancer/load-balancer.module";

@Module({
    imports: [EnvModule, LoadBalancerModule],
    controllers: [HealthController],
    providers: [],
})
export class AppModule {}