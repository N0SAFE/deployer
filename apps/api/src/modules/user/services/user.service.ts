/**
 * User Service
 * 
 * PURPOSE: User business logic and domain rules
 * 
 * RESPONSIBILITIES:
 * - Business logic and validations
 * - Orchestrate repository calls
 * - Return entities (NOT contract types)
 * - Domain exception handling
 * 
 * PATTERN: Service-Adapter Pattern
 * - Services return entities
 * - Generic, composable method names
 * - NO contract transformations
 * - NO HTTP exceptions (use domain exceptions)
 */

import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRepository, type CreateUserInput, type UpdateUserInput, type GetUsersInput } from '../repositories/user.repository';

@Injectable()
export class UserService {
    constructor(private readonly userRepository: UserRepository) { }

    /**
     * ✅ Generic method: Find user by ID
     * Returns entity (nullable)
     */
    async findById(id: string) {
        const user = await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return user;
    }

    /**
     * ✅ Generic method: Find user by email
     * Returns entity (nullable)
     */
    async findByEmail(email: string) {
        const user = await this.userRepository.findByEmail(email);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return user;
    }

    /**
     * ✅ Generic method: Find all users with pagination
     * Returns entities with pagination metadata
     */
    async findMany(input: GetUsersInput) {
        return await this.userRepository.findMany(input);
    }

    /**
     * ✅ Business logic: Create a new user
     * Validates email uniqueness
     * Returns entity
     */
    async create(input: CreateUserInput) {
        // Business validation: Check if user already exists with this email
        const existingUser = await this.userRepository.findByEmail(input.email);
        if (existingUser) {
            throw new ConflictException('User with this email already exists');
        }
        return await this.userRepository.create(input);
    }

    /**
     * ✅ Business logic: Update user
     * Validates email uniqueness if email is being updated
     * Returns entity (nullable)
     */
    async update(id: string, input: UpdateUserInput) {
        const existingUser = await this.userRepository.findById(id);
        if (!existingUser) {
            return null;
        }

        // Business validation: Check if email is being updated and if it conflicts
        if (input.email && input.email !== existingUser.email) {
            const emailExists = await this.userRepository.existsByEmail(input.email);
            if (emailExists) {
                throw new ConflictException('User with this email already exists');
            }
        }

        return await this.userRepository.update(id, input);
    }

    /**
     * ✅ Business logic: Delete user
     * Returns entity (nullable)
     */
    async delete(id: string) {
        const existingUser = await this.userRepository.findById(id);
        if (!existingUser) {
            return null;
        }
        return await this.userRepository.delete(id);
    }

    /**
     * ✅ Partial entity method: Check if email exists
     * Returns boolean
     */
    async checkEmailExists(email: string): Promise<boolean> {
        return await this.userRepository.existsByEmail(email);
    }

    /**
     * ✅ Partial entity method: Get user count
     * Returns number
     */
    async getCount(): Promise<number> {
        return await this.userRepository.getCount();
    }
}
