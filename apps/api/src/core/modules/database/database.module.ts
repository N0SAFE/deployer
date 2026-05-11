import { Global, Module } from "@nestjs/common";
import { GlobalModule } from "./global/global.module";
import { LocalModule } from "./local/local.module";

@Global()
@Module({
    imports: [LocalModule, GlobalModule],
    providers: [],
    exports: [
        LocalModule,
        GlobalModule,
    ],
})
export class DatabaseModule {}