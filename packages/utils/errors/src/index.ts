/**
 * @repo/errors — Canonical application error hierarchy
 *
 * All custom errors across the monorepo should extend these base classes
 * instead of `Error` directly. This ensures consistent error codes,
 * context serialization, and stack trace handling.
 *
 * ## Why this package exists
 *
 * Before this package, the same error classes were defined in
 * `apps/api/src/core/errors/` and could only be used by the API.
 * Centralizing them:
 *
 * 1. Codifies the error standard enforced by `.github/copilot-instructions.md`
 * 2. Makes errors reusable across apps and packages
 * 3. Ensures consistent error codes and serialization
 * 4. Provides a single point for audit and testing
 *
 * ## Usage
 *
 * ```typescript
 * import { NotFoundError, BadRequestError } from "@repo/errors"
 *
 * throw new NotFoundError("User", userId)
 * throw new BadRequestError("Invalid input", { field: "email" })
 * ```
 *
 * ## Module-specific errors
 *
 * Extend AppError for module-specific errors:
 *
 * ```typescript
 * import { AppError } from "@repo/errors"
 *
 * export class MeshTimeoutError extends AppError {
 *   constructor(peerId: string) {
 *     super(`Mesh peer ${peerId} timed out`, "MESH_TIMEOUT", { peerId })
 *   }
 * }
 * ```
 */

export {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  TimeoutError,
  ServiceUnavailableError,
  BadRequestError,
} from './app-error';
export type { ValidationIssue } from './app-error';
export { getErrorMessage } from './get-error-message';
