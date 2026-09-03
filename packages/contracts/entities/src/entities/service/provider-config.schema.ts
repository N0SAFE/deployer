import z from "zod/v4";

export const githubProviderConfigSchema = z
  .object({
    providerAppId: z.string().optional(),
    sourceUrl: z.string().min(1),
    branch: z.string().min(1),
    rootPath: z.string().min(1),
    buildContext: z.string().min(1),
    dockerfilePath: z.string().optional(),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
  })
  .strict();

export const gitlabProviderConfigSchema = githubProviderConfigSchema;
export const bitbucketProviderConfigSchema = githubProviderConfigSchema;

export const artifactBundleProviderConfigSchema = z
  .object({
    sourceUrl: z.string().min(1),
    branch: z.string().min(1),
    rootPath: z.string().min(1),
    buildContext: z.string().min(1),
    image: z.string().min(1),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
  })
  .strict();

export const containerRegistryProviderConfigSchema = artifactBundleProviderConfigSchema;

export const manualProviderConfigSchema = z
  .object({
    sourceUrl: z.string().min(1),
    branch: z.string().min(1),
    rootPath: z.string().min(1),
    buildContext: z.string().min(1),
    dockerfilePath: z.string().optional(),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
  })
  .strict();

export const providerConfigSchemaById = {
  github: githubProviderConfigSchema,
  gitlab: gitlabProviderConfigSchema,
  bitbucket: bitbucketProviderConfigSchema,
  "artifact-bundle": artifactBundleProviderConfigSchema,
  "container-registry": containerRegistryProviderConfigSchema,
  manual: manualProviderConfigSchema,
} as const;

export const serviceProviderConfigUnionSchema = z.union([
  githubProviderConfigSchema,
  gitlabProviderConfigSchema,
  bitbucketProviderConfigSchema,
  artifactBundleProviderConfigSchema,
  containerRegistryProviderConfigSchema,
  manualProviderConfigSchema,
]);
