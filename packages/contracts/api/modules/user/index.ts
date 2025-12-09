import { oc } from "@orpc/contract";
/**
 * User Contract - Authentication and User Management
 *
 * **PURPOSE**: Core user lifecycle management and authentication operations
 *
 * **SCOPE**: This contract provides essential user functionality including:
 * - User CRUD operations (create, read, update, delete)
 * - Profile management and settings
 * - Email verification and validation
 * - User search and listing with pagination
 * - Account statistics and metrics
 *
 * **FRONTEND INTEGRATION**: ✅ Actively used by frontend components
 * - Authentication flows (login, register, profile)
 * - User dashboard and settings pages
 * - Admin user management interfaces
 * - User search and selection components
 *
 * **SECURITY CONSIDERATIONS**:
 * - Integrates with Better Auth for secure authentication
 * - Proper input validation and sanitization
 * - Role-based access control for sensitive operations
 * - Email verification workflows
 *
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - Required by all authenticated endpoints
 * - Used by `project` contract for team management
 * - Referenced by `analytics` for user behavior tracking
 *
 * Routes: /user/*
 * Status: 🟢 Production Ready - Fully active and stable
 * Frontend Usage: ✅ Core authentication and profile management
 * Backend Integration: ✅ Better Auth + database persistence
 *
 * @example
 * // Get current user profile
 * const user = await orpc.user.findById({ id: currentUserId });
 *
 * // Update user settings
 * await orpc.user.update({
 *   id: userId,
 *   data: { displayName: "New Name" }
 * });
 *
 * // Check email availability
 * const available = await orpc.user.checkEmail({ email: "test@example.com" });
 *
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../project/index.ts for team management features
 */
// Import all contract definitions
import { userListContract } from './list';
import { userFindByIdContract } from './findById';
import { userCreateContract } from './create';
import { userUpdateContract } from './update';
import { userDeleteContract } from './delete';
import { userCheckEmailContract } from './checkEmail';
import { userCountContract } from './count';
// Combine into main user contract
export const userContract = oc.tag("User").prefix("/user").router({
    list: userListContract,
    findById: userFindByIdContract,
    create: userCreateContract,
    update: userUpdateContract,
    delete: userDeleteContract,
    checkEmail: userCheckEmailContract,
    count: userCountContract,
});
export type UserContract = typeof userContract;
// Re-export everything from individual contracts
export * from './list';
export * from './findById';
export * from './create';
export * from './update';
export * from './delete';
export * from './checkEmail';
export * from './count';
