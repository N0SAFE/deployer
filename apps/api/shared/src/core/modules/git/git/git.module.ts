import { createModuleContext, effectHostProvider, serviceLifecycle } from "@deployer/nest-effect";

import { GitService, makeGitService } from './services/git.service';

/**
 * CORE MODULE: Git Operations
 *
 * Provides fundamental Git infrastructure services that are provider-agnostic.
 * This module handles local git operations (clone, extract an upload, commit info, cleanup, remote probe).
 *
 * Services exported:
 * - GitService: Git repository operations; it owns the workspace directory (`WORKSPACE_DIR`) and creates it on start.
 *
 * Architecture Notes:
 * - Located at: core/modules/git/git/
 * - Provider-specific modules (github/, gitlab/, gitea/) are siblings
 * - Import this module when you need basic git operations
 */
export class GitModule extends createModuleContext({
  providers: [
    effectHostProvider(),
    {
      provide: GitService,
      useFactory: () => makeGitService({ workspaceDir: process.env.WORKSPACE_DIR ?? '/tmp/deployer-workspace' }),
    },
    serviceLifecycle(GitService),
  ],
  exports: [GitService],
}) {}
