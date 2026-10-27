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
} from './config.error';

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
} from './file-system.error';

// Template errors
export {
  TemplateError,
  TemplateSyntaxError,
  TemplateVariableError,
  TemplateNotFoundError,
  TemplateRenderError,
} from './template.error';

// Middleware errors
export {
  MiddlewareError,
  MiddlewareNotFoundError,
  MiddlewareConfigurationError,
} from './middleware.error';

// SSL/TLS errors
export {
  SSLCertificateError,
  SSLCertificateNotFoundError,
  SSLCertificateExpiredError,
  SSLCertificateValidationError,
} from './ssl.error';
