/**
 * User Controller
 * 
 * PURPOSE: HTTP endpoints for user management
 * 
 * RESPONSIBILITIES:
 * - Orchestrate service calls
 * - Aggregate data from multiple service methods
 * - Pass aggregated data to adapters
 * - Return contract types via adapters
 * - Handle HTTP-specific concerns (errors, validation)
 * 
 * PATTERN: Service-Adapter Pattern
 * - Controllers orchestrate (not delegate)
 * - Mix multiple service methods
 * - Use adapters for transformations
 */

import { Controller, NotFoundException } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { userContract } from '@repo/api-contracts';
import { UserService } from '../services/user.service';
import { UserAdapter } from '../adapters/user-adapter.service';

@Controller()
export class UserController {
    constructor(
        private readonly userService: UserService,
        private readonly userAdapter: UserAdapter,
    ) { }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Get paginated list of users
     */
    @Implement(userContract.list)
    list() {
        return implement(userContract.list).handler(async ({ input }) => {
            // Fetch data from service
            const data = await this.userService.findMany(input);
            
            // Transform via adapter
            return this.userAdapter.adaptUserListToContract(data);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Get user by ID
     */
    @Implement(userContract.findById)
    findById() {
        return implement(userContract.findById).handler(async ({ input }) => {
            // Fetch entity from service
            const user = await this.userService.findById(input.id);
            
            // Transform via adapter (handles null case)
            return this.userAdapter.adaptUserToContract(user);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Create a new user
     */
    @Implement(userContract.create)
    create() {
        return implement(userContract.create).handler(async ({ input }) => {
            // Create via service (includes business validation)
            const user = await this.userService.create(input);
            
            // Transform via adapter
            return this.userAdapter.adaptUserCreateToContract(user);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Update user by ID
     */
    @Implement(userContract.update)
    update() {
        return implement(userContract.update).handler(async ({ input }) => {
            // Update via service (includes business validation)
            const user = await this.userService.update(input.id, input);
            
            // Transform via adapter (handles null case)
            return this.userAdapter.adaptUserUpdateToContract(user);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Delete user by ID
     */
    @Implement(userContract.delete)
    delete() {
        return implement(userContract.delete).handler(async ({ input }) => {
            // Delete via service
            const user = await this.userService.delete(input.id);
            
            // Transform via adapter (handles null case)
            return this.userAdapter.adaptUserDeleteToContract(user);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Check if email exists
     */
    @Implement(userContract.checkEmail)
    checkEmail() {
        return implement(userContract.checkEmail).handler(async ({ input }) => {
            // Check via service
            const exists = await this.userService.checkEmailExists(input.email);
            
            // Transform via adapter
            return this.userAdapter.adaptUserCheckEmailToContract(exists);
        });
    }

    /**
     * ✅ Orchestrate: Service + Adapter
     * Get user count
     */
    @Implement(userContract.count)
    count() {
        return implement(userContract.count).handler(async () => {
            // Get count from service
            const count = await this.userService.getCount();
            
            // Transform via adapter
            return this.userAdapter.adaptUserCountToContract(count);
        });
    }
}
