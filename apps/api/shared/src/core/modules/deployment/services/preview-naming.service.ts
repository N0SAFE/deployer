import { createHash } from 'node:crypto'

import { Context, Effect } from 'effect'

import type { PreviewTemplateConfig } from '@deployer/contracts-entities'
import { domainError } from '@deployer/effect-core'

import { slugify } from '../../../utils/slug.utils'

export type PreviewNamingInput = {
    serviceId: string
    branchName?: string | null
    prNumber?: number | null
    commitSha?: string | null
    urlPattern: string
    namingStrategy: PreviewTemplateConfig['namingStrategy']
}

export type PreviewNamingResult = {
    previewName: string
    resolvedUrl: string
    strategy: PreviewTemplateConfig['namingStrategy']
}

export class PreviewNamingInvalid extends domainError(
    'PreviewNamingInvalid',
    'validation'
)<{ readonly reason: string }>() {
    override publicMessage() {
        return this.reason
    }
}

/** Pure and stateless: the preview name and URL a branch / pull request gets. Fails with `PreviewNamingInvalid`. */
export type PreviewNamingShape = {
    readonly buildPreviewName: (
        input: PreviewNamingInput
    ) => Effect.Effect<PreviewNamingResult, PreviewNamingInvalid>
}

function toSlug(value: string): string {
    return slugify(value, {
        maxLength: 48,
        fallback: 'preview',
        trimInput: true,
    })
}

function resolveUrlPattern(
    pattern: string,
    tokens: Record<string, string>
): string {
    return Object.entries(tokens).reduce(
        (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
        pattern
    )
}

function tokensOf(
    input: PreviewNamingInput,
    previewName: string
): Record<string, string> {
    return {
        preview_name: previewName,
        branch: input.branchName ? toSlug(input.branchName) : '',
        pr_number: input.prNumber != null ? String(input.prNumber) : '',
        commit_sha: input.commitSha ? input.commitSha.slice(0, 7) : '',
    }
}

function resolveName(
    input: PreviewNamingInput
): Effect.Effect<string, PreviewNamingInvalid> {
    switch (input.namingStrategy) {
        case 'pr': {
            if (input.prNumber == null) {
                return Effect.fail(
                    new PreviewNamingInvalid({
                        reason: 'namingStrategy=pr requires prNumber',
                    })
                )
            }
            return Effect.succeed(`pr-${String(input.prNumber)}`)
        }
        case 'branch': {
            if (!input.branchName) {
                return Effect.fail(
                    new PreviewNamingInvalid({
                        reason: 'namingStrategy=branch requires branchName',
                    })
                )
            }
            return Effect.succeed(toSlug(input.branchName))
        }
        case 'branch_hash': {
            if (!input.branchName) {
                return Effect.fail(
                    new PreviewNamingInvalid({
                        reason: 'namingStrategy=branch_hash requires branchName',
                    })
                )
            }
            const hashSeed = `${input.serviceId}:${input.branchName}:${input.commitSha ?? ''}`
            const fragment = createHash('sha256')
                .update(hashSeed)
                .digest('hex')
                .slice(0, 7)
            return Effect.succeed(`${toSlug(input.branchName)}-${fragment}`)
        }
        case 'custom':
            return Effect.succeed(
                toSlug(resolveUrlPattern(input.urlPattern, tokensOf(input, '')))
            )
    }
}

export function makePreviewNaming(): PreviewNamingShape {
    return {
        buildPreviewName: (input) =>
            Effect.map(resolveName(input), (previewName) => ({
                previewName,
                resolvedUrl: resolveUrlPattern(
                    input.urlPattern,
                    tokensOf(input, previewName)
                ),
                strategy: input.namingStrategy,
            })),
    }
}

export class PreviewNamingService extends Context.Service<
    PreviewNamingService,
    PreviewNamingShape
>()('shared/PreviewNamingService') {
    static readonly live: PreviewNamingShape = makePreviewNaming()
}
