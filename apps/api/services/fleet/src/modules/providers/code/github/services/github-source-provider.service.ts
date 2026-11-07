import { Context, Effect } from 'effect'
import z from 'zod/v4'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import { attemptSync } from '@/core/effects'
import { FleetInvalid } from '@/core/fleet.errors'
import { Git } from '@/core/ports/git.port'

import { githubSourceCheckoutContextSchema } from '../../../base/source-provider.interface'

import type { CodeProvider } from '../../shared/code-provider.interface'

const githubSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
})

/** The provider for a GitHub repository: validates it is reachable, then names the ref to check out. */
export type GithubSourceProviderServiceShape = CodeProvider

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class GithubSourceProviderService extends Context.Service<
    GithubSourceProviderService,
    GithubSourceProviderServiceShape
>()('fleet/GithubSourceProviderService') {
    static readonly live = class GithubSourceProviderServiceImpl
        implements GithubSourceProviderServiceShape
    {
        resolveSourceCheckout(
            input: DeploymentTriggerInput
        ): ReturnType<
            GithubSourceProviderServiceShape['resolveSourceCheckout']
        > {
            return Effect.gen(function* () {
                if (input.source.sourceType !== 'github') return null

                const parsed = githubSourceContextSchema.safeParse({
                    repositoryUrl: input.source.repositoryUrl,
                    branch: input.source.branch,
                    commitSha: input.source.commitSha,
                    pullRequestNumber: input.source.pullRequestNumber,
                })
                if (!parsed.success) {
                    return yield* new FleetInvalid({
                        reason: 'GitHub source requires source.repositoryUrl',
                    })
                }

                const { repositoryUrl, branch, commitSha, pullRequestNumber } =
                    parsed.data
                const resolvedBranch =
                    branch ??
                    (pullRequestNumber
                        ? `refs/pull/${String(pullRequestNumber)}/head`
                        : 'main')

                const git = yield* Git
                const isValidRepository =
                    yield* git.validateRepository(repositoryUrl)
                if (!isValidRepository) {
                    return yield* new FleetInvalid({
                        reason: `GitHub repository '${repositoryUrl}' is not accessible`,
                    })
                }

                return yield* attemptSync(() =>
                    githubSourceCheckoutContextSchema.parse({
                        provider: 'github',
                        repositoryUrl,
                        branch: resolvedBranch,
                        ...(commitSha ? { commitSha } : {}),
                        ...(pullRequestNumber ? { pullRequestNumber } : {}),
                    })
                )
            })
        }
    }
}
