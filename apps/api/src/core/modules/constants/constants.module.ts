import { Global, Module } from "@nestjs/common";
import { ConstantsService } from "./services/constants.service";
import { EnvModule } from "@/config/env/env.module";

@Global()
@Module({
    imports: [EnvModule],
    providers: [ConstantsService],
    exports: [ConstantsService],
})
export class ConstantsModule {}