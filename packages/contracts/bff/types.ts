/**
 * Input/output aliases for the test surface.
 *
 * These describe the `test` module, which this package owns — they used to sit
 * beside the user aliases in one file, which is why the split had to separate
 * them rather than move the file wholesale.
 */

// ====================
// Test Types
// ====================

export type {
  TestNonAuthenticatedInput,
  TestNonAuthenticatedOutput,
} from './modules/test/non-authenticated';

export type {
  TestAuthenticatedInput,
  TestAuthenticatedOutput,
} from './modules/test/authenticated';

export type {
  TestFileUploadInput,
  TestFileUploadOutput,
} from './modules/test/file-upload';

export type {
  TestFileDownloadInput,
  TestFileDownloadOutput,
} from './modules/test/file-download';

export type {
  TestStreamOutputInput,
  TestStreamOutputOutput,
} from './modules/test/stream-output';
