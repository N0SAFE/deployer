# Auth — Subagent 1/3: API/Backend Layer

## Module Structure
- Location: `apps/api/src/core/modules/auth/`
- Source files: ~30 (excluding specs)
- Spec files: 8
- Sub-directories: decorators, definitions, filters, guards, middlewares, orpc, plugin-utils, services, types, utils

## Key Components
### AuthModule
- Dynamic module with `forRoot()`/`forRootAsync()` patterns
- Registers `AuthCoreService` (singleton) + `AuthService` (REQUEST-scoped)
- Implements `NestModule` + `OnModuleInit`
- Applies `AuthGuard` globally via `APP_GUARD`

### AuthCoreService
- Singleton business logic for auth operations
- Wraps BetterAuth operations

### AuthService
- REQUEST-scoped wrapper auto-injecting HTTP headers
- Delegate to AuthCoreService

### AuthGuard
- Global guard with `@Public()` decorator for opt-out
- Role check integration via `RoleGuard`

### ORPC Middleware
- `requireAuth()` middleware for ORPC handlers
- `requireOrganizationRole()`, `requirePlatformRole()` middleware-factories
- 1 TODO (ph2): replace with proper DI once middleware pattern supports it

## Auth Configuration
- Better Auth setup at `apps/api/src/auth.ts`
- Email/password provider
- Organization plugin
- Admin plugin

## Tests
- 8 spec files: auth.service, decorators, utils/context, orpc/types, orpc/middlewares, orpc/auth-utils, guards/auth.guard, guards/role.guard

## Issues
- Type violations: Several `as unknown as` in guards, middlewares, plugin-utils, services (bearer token extraction patterns)
- 1 TODO in orpc/middlewares.ts:33 (replace with proper DI)
- DI uses class tokens (good practice) with some `@Inject()` string tokens

## Todo List (API Layer Only)
1. [M] Fix `as unknown as` violations in guards, middlewares, plugin-utils — replace with typed extraction functions
2. [M] Resolve TODO(ph2) in orpc/middlewares.ts — replace with proper DI
3. [S] Add tests for auth-core.service.ts (no spec found)
4. [S] Review DI token consistency — prefer class tokens over string tokens
