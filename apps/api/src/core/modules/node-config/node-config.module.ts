import { Global, Module } from "@nestjs/common";
import { NodeConfigService } from "./node-config.service";

@Global()
@Module({
    providers: [NodeConfigService],
    exports: [NodeConfigService],
})
export class NodeConfigModule {}
