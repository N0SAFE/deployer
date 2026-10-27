import z from 'zod/v4'

/* ─── PROVIDER CONFIG SCHEMAS (per-provider-type shapes) ─────────── */

/** GitHub-specific: select an App, then a repo auto-fills URL + branch. */
const githubConfigSchema = z.object({
    providerAppId: z.string().min(1, 'Select a GitHub App'),
    sourceUrl: z.string().min(1, 'Repository URL is required'),
    branch: z.string().min(1, 'Branch is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/** GitLab / Bitbucket: manual URL + branch (no dynamic app picker yet). */
const manualGitConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Repository URL is required'),
    branch: z.string().min(1, 'Branch is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/** Container registry: image reference only. */
const containerRegistryConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Image URL is required'),
    image: z.string().optional(),
    authSecretRef: z.string().min(1),
}).strict()

/** Artifact bundle: a download URL. */
const artifactBundleConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Bundle URL is required'),
    authSecretRef: z.string().min(1),
}).strict()

/** Manual: free-form source. */
const manualConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Source URL is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/* ─── PROVIDER DISCRIMINATED UNION ───────────────────────────────── */

export const providerSchema = z.discriminatedUnion('providerId', [
    z.object({ providerId: z.literal('github'), config: githubConfigSchema }),
    z.object({ providerId: z.literal('gitlab'), config: manualGitConfigSchema }),
    z.object({ providerId: z.literal('bitbucket'), config: manualGitConfigSchema }),
    z.object({ providerId: z.literal('container-registry'), config: containerRegistryConfigSchema }),
    z.object({ providerId: z.literal('artifact-bundle'), config: artifactBundleConfigSchema }),
    z.object({ providerId: z.literal('manual'), config: manualConfigSchema }),
])
