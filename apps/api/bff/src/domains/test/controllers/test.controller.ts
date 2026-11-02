/**
 * Test Controller - Auth & Authorization Patterns Demo
 * 
 * This controller demonstrates the RECOMMENDED patterns for authentication and authorization
 * using the AuthService as the SINGLE SOURCE OF TRUTH.
 * 
 * ## AuthService API:
 * 
 * ### NestJS Guards (`authService.guards.*`)
 * - `guards.admin.hasRole(['admin', 'superAdmin'])` - Check admin roles
 * - `guards.admin.hasPermission({ user: ['read'] })` - Check admin permissions
 * - `guards.admin.requireAdminRole()` - Require admin role
 * - `guards.admin.composite([checks])` - Combine multiple checks
 * 
 * ### ORPC Middlewares (`authService.middleware.*`)
 * 
 * **Two usage patterns available on EVERY middleware:**
 * 
 * 1. **Static values** - Direct call with values:
 *    ```typescript
 *    .use(middleware.admin.hasPermission({ user: ['list'] }))
 *    ```
 * 
 * 2. **Dynamic with `.forInput()`** (RECOMMENDED) - Uses ORPC's mapInput for auto-typed input:
 *    ```typescript
 *    .use(middleware.admin.hasPermission.forInput(), input => ({ [input.resource]: [input.action] }))
 *    ```
 *    The `.forInput()` method is available on ALL middlewares and returns a middleware
 *    that expects the first parameter's type as input via ORPC's mapInput callback.
 * 
 * **Available middlewares:**
 * - `middleware.admin.hasPermission(permissions)` / `.forInput()` → extracts permissions type
 * - `middleware.admin.hasRole(roles)` / `.forInput()` → extracts roles type
 * - `middleware.admin.requireAdminRole()` - Static only (no input needed)
 * - `middleware.admin.hasPermissionByRole(role, permissions)` / `.forInput()` → extracts role type
 * 
 * ### Raw Checks (`authService.checks.*`)
 * - Used for advanced composition with `guards.admin.composite()` or `middleware.admin.composite()`
 * 
 * ## Usage Patterns:
 * 
 * ### Pattern 1: Static values (simple cases)
 * ```typescript
 * .use(middleware.admin.hasPermission({ user: ['list'] }))
 * ```
 * 
 * ### Pattern 2: Dynamic with .forInput() + mapInput (RECOMMENDED)
 * ```typescript
 * .use(
 *   middleware.admin.hasPermission.forInput(),  // Middleware expects input
 *   input => ({ user: [input.action] })        // ORPC auto-types input from schema
 * )
 * ```
 */

import { Controller, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { oc } from "@orpc/contract";
import { Implement } from "@orpc/nest";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import * as z from "zod/v4";

// Auth Service (single source of truth)

// NestJS Guards

// NestJS Decorators

// ORPC Middlewares
import { requireAuth, publicAccess } from "@/core/modules/auth/orpc/middlewares";
import { assertAuthenticated } from "@/core/modules/auth/orpc/types";
import { AuthService } from "@/core/modules/auth/services/auth.service";

// Types


// =============================================================================
// ORPC CONTRACTS
// =============================================================================

const testContracts = oc.meta(openapi({ prefix: "/test/orpc" })).router({
    // =========================================================================
    // Public Access
    // =========================================================================
    
    /** Public endpoint - no auth required */
    publicEndpoint: oc.meta(openapi({ method: "GET", path: "/public", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            authenticated: z.boolean(),
        })
    ),
    
    // =========================================================================
    // Basic Authentication
    // =========================================================================
    
    /** Requires authentication - any logged-in user */
    authenticatedEndpoint: oc.meta(openapi({ method: "GET", path: "/authenticated", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            userId: z.string(),
            userEmail: z.string().optional(),
        })
    ),
    
    /** Optional auth - works with or without authentication */
    optionalAuthEndpoint: oc.meta(openapi({ method: "GET", path: "/optional-auth", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            isAuthenticated: z.boolean(),
            userId: z.string().nullable(),
        })
    ),
    
    // =========================================================================
    // Admin Role-Based Access Control
    // =========================================================================
    
    /** Requires ANY of specified admin roles */
    adminRoleEndpoint: oc.meta(openapi({ method: "GET", path: "/admin/role", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            userRole: z.string(),
        })
    ),
    
    /** Requires specific admin permission */
    adminPermissionEndpoint: oc.meta(openapi({ method: "GET", path: "/admin/permission", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            userId: z.string(),
            userRole: z.string(),
        })
    ),
    
    /** Dynamic admin permission from input */
    adminDynamicPermissionEndpoint: oc.meta(openapi({ method: "POST", path: "/admin/dynamic-permission", })).input(z.object({
        resource: z.enum(["user", "invitation", "session"]),
        action: z.enum(["create", "read", "update", "delete"]),
    })).output(
        z.object({
            message: z.string(),
            resource: z.string(),
            action: z.string(),
            userId: z.string(),
        })
    ),
    
    // =========================================================================
    // Composite Patterns
    // =========================================================================
    
    /** Combined: Admin role + permission (using composite) */
    compositeAdminEndpoint: oc.meta(openapi({ method: "GET", path: "/composite/admin", })).input(z.object({})).output(
        z.object({
            message: z.string(),
            userId: z.string(),
            userRole: z.string(),
        })
    ),
    
    // =========================================================================
    // Type-Safe Context Examples
    // =========================================================================
    
    /** Demonstrates type-safe context access from previous middlewares */
    contextAccessEndpoint: oc.meta(openapi({ method: "GET", path: "/context-access/{resourceId}", })).input(z.object({
    })).output(
        z.object({
            message: z.string(),
            userId: z.string(),
            userRole: z.string(),
        })
    ),
});

export { testContracts as testAuthPatternsContract };

// =============================================================================
// CONTROLLER
// =============================================================================

@ApiTags("Test - Auth Patterns")
@Controller()
export class TestController {
    constructor(private readonly authService: AuthService) {}
  private readonly logger = new Logger(TestController.name)

    // =========================================================================
    // ORPC MIDDLEWARE-BASED PATTERNS (using AuthService.middleware)
    // =========================================================================
    
    // -------------------------------------------------------------------------
    // Public Access
    // -------------------------------------------------------------------------
    @Implement(testContracts.publicEndpoint)
    publicOrpc() {
        return implement(testContracts.publicEndpoint)
            .use(publicAccess())
            .handler(({ context }) => {
                return {
                    message: "Public ORPC endpoint - no authentication required",
                    authenticated: context.auth.isLoggedIn,
                };
            });
    }
    
    // -------------------------------------------------------------------------
    // Basic Authentication
    // -------------------------------------------------------------------------
    
    @Implement(testContracts.authenticatedEndpoint)
    authenticatedOrpc() {
        return implement(testContracts.authenticatedEndpoint)
            .use(requireAuth())
            .handler(({ context }) => {
                const { auth } = context;
                return {
                    message: "Authenticated ORPC endpoint - requires valid session",
                    userId: auth.user.id,
                    userEmail: auth.user.email,
                };
            });
    }
    
    @Implement(testContracts.optionalAuthEndpoint)
    optionalAuthOrpc() {
        return implement(testContracts.optionalAuthEndpoint)
            .use(publicAccess())
            .handler(({ context }) => {
                return {
                    message: "Optional auth ORPC endpoint - session may be null",
                    isAuthenticated: context.auth.isLoggedIn,
                    userId: context.auth.user?.id ?? null,
                };
            });
    }
    
    // -------------------------------------------------------------------------
    // Admin Role-Based Access Control (using AuthService.middleware)
    // -------------------------------------------------------------------------
    
    @Implement(testContracts.adminRoleEndpoint)
    adminRoleOrpc() {
        return implement(testContracts.adminRoleEndpoint)
            .use(requireAuth())
            // Static role check - no generic needed
            .use(this.authService.middleware.admin.hasRole(['admin', 'superAdmin']))
            .handler(({ context }) => {
                const auth = assertAuthenticated(context.auth);
                
                return {
                    message: "Admin role access granted via authService.middleware.admin.hasRole()",
                    userRole: auth.user.role ?? "unknown",
                };
            });
    }
    
    @Implement(testContracts.adminPermissionEndpoint)
    adminPermissionOrpc() {
        return implement(testContracts.adminPermissionEndpoint)
            .use(requireAuth())
            // Static permission check - accepts relaxed PermissionObject type
            .use(this.authService.middleware.admin.hasPermission({ user: ['list'] }))
            .handler(({ context }) => {
                const auth = assertAuthenticated(context.auth);
                return {
                    message: "Admin permission access granted via authService.middleware.admin.hasPermission()",
                    userId: auth.user.id,
                    userRole: auth.user.role ?? "unknown",
                };
            });
    }
    
    @Implement(testContracts.adminDynamicPermissionEndpoint)
    adminDynamicPermissionOrpc() {
        return implement(testContracts.adminDynamicPermissionEndpoint)
            .use(requireAuth())
            // Dynamic permission from input - uses .forInput() + mapInput for auto-typed input
            //
            // oRPC v2 REMOVED the two-argument `.use(middleware, mapInput)`
            // form; the input transform is now `adaptInput` (v1's `.mapInput`).
            .use(
                this.authService.middleware.admin.hasPermission
                    .forInput()
                    .adaptInput((input) => ({ [input.resource]: [input.action] })),
            )
            .handler(({ context, input }) => {
                const auth = assertAuthenticated(context.auth);
                return {
                    message: "Dynamic admin permission granted via authService.middleware.admin.hasPermission(resolver)",
                    resource: input.resource,
                    action: input.action,
                    userId: auth.user.id,
                };
            });
    }
    
    // -------------------------------------------------------------------------
    // Composite Patterns (using AuthService.middleware.composite)
    // -------------------------------------------------------------------------
    
    @Implement(testContracts.compositeAdminEndpoint)
    compositeAdminOrpc() {
        // Get raw checks from authService.checks
        const checks = [
            this.authService.checks.admin.requireSession(),
            this.authService.checks.admin.hasRole(['admin', 'superAdmin'] as const),
            this.authService.checks.admin.hasPermission({ user: ['list'] }),
        ];
        
        return implement(testContracts.compositeAdminEndpoint)
            .use(requireAuth())
            // Composite middleware from multiple checks
            .use(this.authService.middleware.admin.composite(checks))
            .handler(({ context }) => {
                const auth = assertAuthenticated(context.auth);
                return {
                    message: "Composite admin access granted via authService.middleware.admin.composite()",
                    userId: auth.user.id,
                    userRole: auth.user.role ?? "unknown",
                };
            });
    }
    
    // -------------------------------------------------------------------------
    // Type-Safe Context Examples (using TContext generic)
    // -------------------------------------------------------------------------
    
    @Implement(testContracts.contextAccessEndpoint)
    contextAccessOrpc() {
        return implement(testContracts.contextAccessEndpoint)
            .use(requireAuth())
            // Use TInput for type-safe input access

            .handler(({ context, input }) => {
                const auth = assertAuthenticated(context.auth);
                return {
                    message: "Authenticated context access",
                    userId: auth.user.id,
                    userRole: auth.user.role ?? "unknown",
                };
            });
    }
}
