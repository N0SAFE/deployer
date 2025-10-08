import { Module } from '@nestjs/common';
import { GitService } from './services/git.service';

/**
 * CORE MODULE: Git
 * Provides Git infrastructure services
 * 
 * This is a CORE module - it provides Git-related infrastructure services.
 * 
 * Services exported:
 * - GitService: Git repository operations
 */
@Module({
  providers: [
    GitService,
  ],
  exports: [
    GitService,
  ],
})
export class GitModule {}
