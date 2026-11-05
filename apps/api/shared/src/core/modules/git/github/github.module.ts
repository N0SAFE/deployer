import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '../../database/storage'

import {
    GithubDeploymentCacheRepository,
    makeGithubDeploymentCacheRepository,
} from './repositories/github-deployment-cache.repository'
import {
    GithubDeploymentRulesRepository,
    makeGithubDeploymentRulesRepository,
} from './repositories/github-deployment-rules.repository'
import {
    GithubRepositoryConfigRepository,
    makeGithubRepositoryConfigRepository,
} from './repositories/github-repository-config.repository'
import { GitHubService, makeGitHubService } from './services/github.service'

import type { Context } from 'effect'

/**
 * CORE MODULE: GitHub API Integration
 *
 * Provides ONLY core GitHub API services. NO controllers, NO processors.
 * All controllers (OAuth, Webhooks) have been moved to feature modules.
 *
 * Services:
 * - GitHubService: GitHub API client, repository operations
 *
 *
 * Architecture Notes:
 * - This is a CORE module - it should ONLY provide services, NO controllers
 * - GitHubOAuthController moved to GitHubOAuthModule (feature module)
 * - GitHubWebhookController moved to GitHubWebhookModule (feature module)
 * - Core modules are imported by CoreModule and made available to all feature modules
 * - Feature modules import CoreModule or specific core modules they need
 */
export class GitHubModule extends createModuleContext({
    providers: [
        // The App registry is in-memory state: one instance per process.
        { provide: GitHubService, useFactory: makeGitHubService },
        {
            provide: GithubDeploymentCacheRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeGithubDeploymentCacheRepository({ database }),
            inject: [DatabasePort],
        },
        {
            provide: GithubDeploymentRulesRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeGithubDeploymentRulesRepository({ database }),
            inject: [DatabasePort],
        },
        {
            provide: GithubRepositoryConfigRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeGithubRepositoryConfigRepository({ database }),
            inject: [DatabasePort],
        },
    ],
    exports: [
        GitHubService,
        GithubDeploymentCacheRepository,
        GithubDeploymentRulesRepository,
        GithubRepositoryConfigRepository,
    ],
}) {}
