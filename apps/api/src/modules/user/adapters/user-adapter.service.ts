/**
 * User Adapter Service
 * 
 * PURPOSE: Transform user entities to contract types
 * 
 * RESPONSIBILITIES:
 * - Pure transformations (entity → contract)
 * - Fixed return types from @repo/api-contracts
 * - NO service dependencies
 * - NO async operations
 * 
 * PATTERN: Service-Adapter Pattern
 * - Receives ALL data as parameters
 * - Returns EXACT contract types
 * - TypeScript enforces contract compliance
 */

import { Injectable } from '@nestjs/common';
import type { user } from '@/config/drizzle/schema';
import type {
    UserContract,
    UserListContract,
    UserCreateContract,
    UserUpdateContract,
    UserDeleteContract,
    UserCheckEmailContract,
    UserCountContract,
} from '../interfaces/user.types';

type User = typeof user.$inferSelect;

@Injectable()
export class UserAdapter {
    /**
     * Adapt single user to contract
     * 
     * @param user - User entity from repository
     * @returns UserContract - Exact contract type (nullable)
     */
    adaptUserToContract(user: User | null): UserContract | null {
        if (!user) {
            return null;
        }

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
        };
    }

    /**
     * Adapt user list with pagination to contract
     * 
     * @param data - Users array and pagination meta from repository
     * @returns UserListContract - Exact contract type
     */
    adaptUserListToContract(data: {
        users: User[];
        meta: { pagination: { total: number; limit: number; offset: number; hasMore: boolean } };
    }): UserListContract {
        return {
            users: data.users.map(user => ({
                id: user.id,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                image: user.image,
                createdAt: user.createdAt.toISOString(),
                updatedAt: user.updatedAt.toISOString(),
            })),
            meta: {
                pagination: {
                    total: data.meta.pagination.total,
                    limit: data.meta.pagination.limit,
                    offset: data.meta.pagination.offset,
                    hasMore: data.meta.pagination.hasMore,
                },
            },
        };
    }

    /**
     * Adapt created user to contract
     * 
     * @param user - Created user entity from repository
     * @returns UserCreateContract - Exact contract type
     */
    adaptUserCreateToContract(user: User): UserCreateContract {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
        };
    }

    /**
     * Adapt updated user to contract
     * 
     * @param user - Updated user entity from repository (should never be null for successful update)
     * @returns UserUpdateContract - Exact contract type (userSchema)
     * @throws Error if user is null (update failed)
     */
    adaptUserUpdateToContract(user: User | null): UserUpdateContract {
        if (!user) {
            throw new Error('Update failed: User not found');
        }

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
        };
    }

    /**
     * Adapt deleted user to contract
     * 
     * @param user - Deleted user entity from repository
     * @returns UserDeleteContract - Discriminated union: {success: true} | {success: false, message: string}
     */
    adaptUserDeleteToContract(user: User | null): UserDeleteContract {
        if (!user) {
            return { success: false, message: 'User not found' };
        }

        return { success: true };
    }

    /**
     * Adapt email check result to contract
     * 
     * @param exists - Boolean result from repository
     * @returns UserCheckEmailContract - Exact contract type
     */
    adaptUserCheckEmailToContract(exists: boolean): UserCheckEmailContract {
        return { exists };
    }

    /**
     * Adapt user count to contract
     * 
     * @param count - Count number from repository
     * @returns UserCountContract - Exact contract type
     */
    adaptUserCountToContract(count: number): UserCountContract {
        return { count };
    }
}
