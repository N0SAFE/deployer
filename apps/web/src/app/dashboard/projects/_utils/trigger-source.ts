import type { DeploymentTriggerSource } from '@repo/api-contracts/modules/deployment/crud'

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The trigger endpoint requires a typed `source`. Derive it from the service's
 * provider: Git providers send their repository + branch, anything else is a
 * `custom` run (the server resolves the source from the service itself).
 */
export function buildTriggerSource(
  providerId: string | null | undefined,
  providerConfig: Record<string, unknown> | null | undefined,
): DeploymentTriggerSource {
  const config = providerConfig ?? {}
  const repositoryUrl = str(config.sourceUrl) ?? str(config.repositoryUrl)
  const branch = str(config.branch) ?? 'main'
  if ((providerId === 'github' || providerId === 'gitlab') && repositoryUrl) {
    return { sourceType: providerId, repositoryUrl, branch }
  }
  return { sourceType: 'custom' }
}
