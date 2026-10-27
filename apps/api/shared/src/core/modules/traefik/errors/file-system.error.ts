import { TraefikError } from './config.error';

/**
 * Base error class for all filesystem-related errors in the Traefik module
 */
export class FileSystemError extends TraefikError {
  constructor(
    message: string,
    code: string,
    public readonly path: string
  ) {
    super(message, code, { path });
    this.name = FileSystemError.name;
  }
}

/**
 * Error thrown when a virtual file is not found
 */
export class FileNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', path);
    this.name = FileNotFoundError.name;
  }
}

/**
 * Error thrown when trying to create a file that already exists
 */
export class FileExistsError extends FileSystemError {
  constructor(path: string) {
    super(`File already exists: ${path}`, 'FILE_EXISTS', path);
    this.name = FileExistsError.name;
  }
}

/**
 * Error thrown when a path is invalid or contains illegal characters
 */
export class InvalidPathError extends FileSystemError {
  constructor(path: string, reason?: string) {
    super(
      `Invalid path: ${path}${reason ? ` - ${reason}` : ''}`,
      'INVALID_PATH',
      path
    );
    this.name = InvalidPathError.name;
  }
}

/**
 * Error thrown when a directory operation fails
 */
export class DirectoryError extends FileSystemError {
  public readonly operation: 'create' | 'delete' | 'list' | 'move' | 'read';
  
  constructor(
    message: string,
    path: string,
    operation: 'create' | 'delete' | 'list' | 'move' | 'read'
  ) {
    super(message, 'DIRECTORY_ERROR', path);
    this.name = DirectoryError.name;
    this.operation = operation;
  }
}

/**
 * Error thrown when a file write operation fails
 */
export class FileWriteError extends FileSystemError {
  constructor(
    path: string,
    public readonly cause?: Error
  ) {
    super(`Failed to write file: ${path}`, 'FILE_WRITE_ERROR', path);
    this.name = FileWriteError.name;
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when a file read operation fails
 */
export class FileReadError extends FileSystemError {
  constructor(
    path: string,
    public readonly cause?: Error
  ) {
    super(`Failed to read file: ${path}`, 'FILE_READ_ERROR', path);
    this.name = FileReadError.name;
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when a file delete operation fails
 */
export class FileDeleteError extends FileSystemError {
  constructor(
    path: string,
    public readonly cause?: Error
  ) {
    super(`Failed to delete file: ${path}`, 'FILE_DELETE_ERROR', path);
    this.name = FileDeleteError.name;
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}
