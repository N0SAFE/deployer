import { Module } from '@nestjs/common';
import { GitService } from './services/git.service';

/**
 * CORE MODULE: Git Operations
 *
 * Provides fundamental Git infrastructure services that are provider-agnostic.
 * This module handles local git operations (clone, pull, checkout, etc.)
 *
 * Services exported:
 * - GitService: Git repository operations (clone, pull, checkout, etc.)
 *
 * Architecture Notes:
 * - Located at: core/modules/git/git/
 * - Provider-specific modules (github/, gitlab/, gitea/) are siblings
 * - Import this module when you need basic git operations
 */
@Module({
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
