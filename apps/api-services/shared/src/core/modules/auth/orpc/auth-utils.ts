import type { ORPCAuthContext } from "@/core/modules/auth/orpc/types";
import { 
  AuthUtils as GlobalAuthUtils, 
  AuthUtilsEmpty as GlobalAuthUtilsEmpty,
  type UserSession
} from "@/core/modules/auth/utils/auth-utils";

// Re-export UserSession for use in plugins
export type { UserSession };

/**
 * Auth utilities class for ORPC handlers
 * This extends the global AuthUtils class and implements ORPCAuthContext
 * All logic is handled by the global AuthUtils class in ../utils/auth-utils.ts
 */
export class AuthUtils extends GlobalAuthUtils implements ORPCAuthContext {}

/**
 * Empty auth utilities for unauthenticated ORPC contexts
 * This extends the global AuthUtilsEmpty class and implements ORPCAuthContext
 */
export class AuthUtilsEmpty extends GlobalAuthUtilsEmpty implements ORPCAuthContext {}