import { Context, Effect } from 'effect'
import z from 'zod/v4'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import { attemptSync } from '@/core/effects'
import { FleetInvalid } from '@/core/fleet.errors'
import { Git } from '@/core/ports/git.port'

import { gitlabSourceCheckoutContextSchema } from '../../../base/source-provider.interface'

import type { CodeProvider } from '../../shared/code-provider.interface'

const gitlabSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    mergeRequestIid: z.number().int().positive().optional(),
})

/** The provider for a GitLab repository: validates it is reachable, then names the ref to check out. */
export type GitlabSourceProviderServiceShape = CodeProvider<Git>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class GitlabSourceProviderService extends Context.Service<
    GitlabSourceProviderService,
    GitlabSourceProviderServiceShape
>()('fleet/GitlabSourceProviderService') {
    static readonly live = class GitlabSourceProviderServiceImpl
        implements GitlabSourceProviderServiceShape
    {
        resolveSourceCheckout(
            input: DeploymentTriggerInput
        ): ReturnType<
            GitlabSourceProviderServiceShape['resolveSourceCheckout']
        > {
            return Effect.gen(function* () {
                if (input.source.sourceType !== 'gitlab') return null

                const parsed = gitlabSourceContextSchema.safeParse({
                    repositoryUrl: input.source.repositoryUrl,
                    branch: input.source.branch,
                    commitSha: input.source.commitSha,
                    mergeRequestIid: input.source.mergeRequestIid,
                })
                if (!parsed.success) {
                    return yield* new FleetInvalid({
                        reason: 'GitLab source requires source.repositoryUrl',
                    })
                }

                const { repositoryUrl, branch, commitSha, mergeRequestIid } =
                    parsed.data
                // GitLab merge-request pipelines target `refs/merge-requests/<iid>/head`.
                const resolvedBranch =
                    branch ??
                    (mergeRequestIid
                        ? `refs/merge-requests/${String(mergeRequestIid)}/head`
                        : 'main')

                const git = yield* Git
                const isValidRepository =
                    yield* git.validateRepository(repositoryUrl)
                if (!isValidRepository) {
                    return yield* new FleetInvalid({
                        reason: `GitLab repository '${repositoryUrl}' is not accessible`,
                    })
                }

                return yield* attemptSync(() =>
                    gitlabSourceCheckoutContextSchema.parse({
                        provider: 'gitlab',
                        repositoryUrl,
                        branch: resolvedBranch,
                        ...(commitSha ? { commitSha } : {}),
                        ...(mergeRequestIid ? { mergeRequestIid } : {}),
                    })
                )
            })
        }
    }
}
