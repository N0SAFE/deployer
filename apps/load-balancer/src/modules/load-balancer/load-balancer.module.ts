import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/modules/auth/auth.module";
import { LoadBalancerController } from "./controllers/load-balancer.controller";
import { LoadBalancerService } from "./services/load-balancer.service";

@Module({
    imports: [AuthModule],
    controllers: [LoadBalancerController],
    providers: [LoadBalancerService],
    exports: [LoadBalancerService],
})
export class LoadBalancerModule {}
