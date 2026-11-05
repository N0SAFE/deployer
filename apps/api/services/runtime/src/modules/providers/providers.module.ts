import {
    createModuleContext,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'
import type { GitServiceShape } from '@deployer/shared/core/modules/git/git/services/git.service'
import { GitModule, GitService } from '@deployer/shared/core/modules/git/index'

import { CustomSourceProvider } from './code/custom/services/custom-source-provider.service'
import {
    GithubSourceProvider,
    makeGithubSourceProvider,
} from './code/github/services/github-source-provider.service'
import {
    GitlabSourceProvider,
    makeGitlabSourceProvider,
} from './code/gitlab/services/gitlab-source-provider.service'
import {
    CodeProviderRegistry,
    makeCodeProviderRegistry,
} from './code/shared/code-provider-registry.service'
import {
    CODE_PROVIDERS,
    type CodeProviderShape,
} from './code/shared/code-provider.interface'
import {
    makeUploadBundleRegistry,
    UploadBundleRegistry,
    type UploadBundleRegistryShape,
} from './code/upload/services/upload-bundle-registry.service'
import {
    makeUploadSourceProvider,
    UploadSourceProvider,
} from './code/upload/services/upload-source-provider.service'
import { SourceGitPort } from './providers.ports'

/**
 * The runtime's SOURCE providers.
 *
 * ── WHY THIS LIVES IN RUNTIME AND NOT IN FLEET ──────────────────────────────
 * These four providers answer one question — "given a deployment trigger, what do I
 * check out?" — and their vocabulary is the RUNTIME contract's (`DeploymentTriggerInput`,
 * `DeploymentSourceCheckoutContext`). Their only in-process caller is this service's
 * `DeploymentService`, mid-build. Nothing in fleet reads them: fleet's own GitHub stack
 * (`preview-provisioning`) resolves DNS and preview rows, not source checkouts.
 *
 * Keeping them in fleet made the deployment workflow reach ACROSS a service boundary on
 * every deploy, which is the coupling the split exists to remove. Fleet keeps the GitHub
 * *app* (installations, OAuth, webhooks) because that is fleet state; runtime keeps the
 * *source resolution* because that is build machinery.
 *
 * ── WHY STILL A COLLECTION UNDER ONE TOKEN ──────────────────────────────────────
 * The registry dispatches by `sourceType`, so the providers must reach it as a
 * COLLECTION. Collecting them under `CODE_PROVIDERS` is what lets a fifth
 * provider be added by listing it here, with no change to the registry or its callers.
 */
export class ProviderDomainsModule extends createModuleContext({
    imports: [GitModule],
    providers: [
        effectHostProvider(),
        { provide: SourceGitPort, useExisting: GitService },
        {
            provide: GithubSourceProvider,
            useFactory: (git: GitServiceShape) =>
                makeGithubSourceProvider({ git }),
            inject: [SourceGitPort],
        },
        {
            provide: GitlabSourceProvider,
            useFactory: (git: GitServiceShape) =>
                makeGitlabSourceProvider({ git }),
            inject: [SourceGitPort],
        },
        {
            provide: UploadBundleRegistry,
            useFactory: () => makeUploadBundleRegistry(),
        },
        {
            provide: UploadSourceProvider,
            useFactory: (bundles: UploadBundleRegistryShape) =>
                makeUploadSourceProvider({ bundles }),
            inject: [UploadBundleRegistry],
        },
        { provide: CustomSourceProvider, useValue: CustomSourceProvider.live },
        {
            provide: CODE_PROVIDERS,
            useFactory: (
                github: CodeProviderShape,
                gitlab: CodeProviderShape,
                upload: CodeProviderShape,
                custom: CodeProviderShape
            ): readonly CodeProviderShape[] => [github, gitlab, upload, custom],
            inject: [
                GithubSourceProvider,
                GitlabSourceProvider,
                UploadSourceProvider,
                CustomSourceProvider,
            ],
        },
        {
            provide: CodeProviderRegistry,
            useFactory: (providers: readonly CodeProviderShape[]) =>
                makeCodeProviderRegistry(providers),
            inject: [CODE_PROVIDERS],
        },
        // The registry declares its start (it logs what it registered); one generic runner binds it.
        serviceLifecycle(CodeProviderRegistry),
    ],
    exports: [CodeProviderRegistry, UploadBundleRegistry],
}) {}
