import { Module } from "@nestjs/common";
import { UserService } from './services/user.service';
import { UserRepository } from './repositories/user.repository';
import { UserController } from './controllers/user.controller';
import { UserAdapter } from './adapters/user-adapter.service';

/**
 * User Module
 * 
 * STRUCTURE: Service-Adapter Pattern
 * - Repository: Database access layer
 * - Service: Business logic layer (returns entities)
 * - Adapter: Transformation layer (entities → contracts)
 * - Controller: HTTP layer (orchestrates service + adapter)
 */
@Module({
    imports: [
    ],
    controllers: [UserController],
    providers: [UserService, UserRepository, UserAdapter],
    exports: [UserService, UserRepository],
})
export class UserModule {
}
