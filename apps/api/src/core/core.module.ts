import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module";
import { DatabaseModule } from "./modules/database/database.module";
import { CoreInitializationModule } from './modules/setup/initialization.module';
import { CoreReachabilityModule } from './modules/reachability/core-reachability.module';

@Module({
    imports: [CoreInitializationModule, CoreReachabilityModule],
    providers: [AuthModule, DatabaseModule],
    exports: [AuthModule, DatabaseModule],
})
export class CoreModule {}
