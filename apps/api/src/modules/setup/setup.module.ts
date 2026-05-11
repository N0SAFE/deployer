import { Module } from "@nestjs/common";
import { SetupController } from "./controllers/setup.controller";
import { CoreInitializationModule } from "@/core/modules/setup/initialization.module";

/**
 * Global Setup Module
 * 
 * Responsibilities:
 * 1. Checks if database is already configured on startup
 * 2. Provides a setup wizard for new installations
 * 3. Emits a completion signal when database is configured
 * 4. Unblocks dependent modules (DatabaseModule, feature modules)
 * 
 * The SetupService holds a Subject that other modules wait for
 * when the database is not yet configured.
 */
@Module({
    imports: [CoreInitializationModule],
    controllers: [SetupController],
    providers: [],
    exports: [],
})
export class SetupModule {}
