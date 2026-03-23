/**
 * Core Error Classes
 * 
 * This module exports all global application error classes.
 * These errors can be used across all modules in the application.
 * 
 * Module-specific errors should extend these base classes and be placed
 * in the module's own errors folder (e.g., modules/traefik/errors/).
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
  type ValidationIssue,
} from './app-error';
