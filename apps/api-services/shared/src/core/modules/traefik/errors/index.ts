/**
 * Traefik Module Error Classes
 * 
 * This module exports all Traefik-specific error classes.
 * Use these errors for Traefik-related operations throughout the module.
 * 
 * Error Hierarchy:
 * - TraefikError (base) extends AppError
 *   - ConfigBuildError
 *   - ConfigSyncError
 *   - ConfigValidationError
 *   - ConfigNotFoundError
 *   - FileSystemError (base)
 *     - FileNotFoundError
 *     - FileExistsError
 *     - InvalidPathError
 *     - DirectoryError
 *     - FileWriteError
 *     - FileReadError
 *     - FileDeleteError
 *   - TemplateError (base)
 *     - TemplateSyntaxError
 *     - TemplateVariableError
 *     - TemplateNotFoundError
 *     - TemplateRenderError
 *   - MiddlewareError
 *     - MiddlewareNotFoundError
 *     - MiddlewareConfigurationError
 *   - SSLCertificateError
 *     - SSLCertificateNotFoundError
 *     - SSLCertificateExpiredError
 *     - SSLCertificateValidationError
 */

// Base Traefik error and config errors
export {
  TraefikError,
  ConfigBuildError,
  ConfigSyncError,
  ConfigValidationError,
  ConfigNotFoundError,
} from '@/core/modules/traefik/errors/config.error';

// File system errors
export {
  FileSystemError,
  FileNotFoundError,
  FileExistsError,
  InvalidPathError,
  DirectoryError,
  FileWriteError,
  FileReadError,
  FileDeleteError,
} from '@/core/modules/traefik/errors/file-system.error';

// Template errors
export {
  TemplateError,
  TemplateSyntaxError,
  TemplateVariableError,
  TemplateNotFoundError,
  TemplateRenderError,
} from '@/core/modules/traefik/errors/template.error';

// Middleware errors
export {
  MiddlewareError,
  MiddlewareNotFoundError,
  MiddlewareConfigurationError,
} from '@/core/modules/traefik/errors/middleware.error';

// SSL/TLS errors
export {
  SSLCertificateError,
  SSLCertificateNotFoundError,
  SSLCertificateExpiredError,
  SSLCertificateValidationError,
} from '@/core/modules/traefik/errors/ssl.error';
