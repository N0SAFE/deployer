import { MOCK_SERVICE_CONFIGS_BY_PROJECT } from './service-configs.mock'
import type { MockServiceProvider } from '../types'

function inferProviderName(type: MockServiceProvider['type']) {
  switch (type) {
    case 'github':
      return 'GitHub App Provider'
    case 'gitlab':
      return 'GitLab CI Provider'
    case 'bitbucket':
      return 'Bitbucket Cloud Provider'
    case 'container-registry':
      return 'Container Registry Provider'
    case 'artifact-bundle':
      return 'Artifact Bundle Provider'
    case 'manual':
      return 'Manual Upload Provider'
    default:
      return 'Generic Provider'
  }
}

export const MOCK_SERVICE_PROVIDERS_BY_PROJECT: Record<string, Record<string, MockServiceProvider>> =
  Object.fromEntries(
    Object.entries(MOCK_SERVICE_CONFIGS_BY_PROJECT).map(([projectId, serviceConfigs]) => {
      const entries = Object.entries(serviceConfigs).map(([serviceId, config]) => {
        const providerId = `provider-${serviceId}`

        return [
          serviceId,
          {
            id: providerId,
            projectId,
            serviceId,
            type: config.providerType,
            name: inferProviderName(config.providerType),
            integrationRef:
              config.providerType === 'github'
                ? 'integration://github/default'
                : config.providerType === 'gitlab'
                  ? 'integration://gitlab/build-farm'
                  : config.providerType === 'container-registry'
                    ? 'integration://registry/primary'
                    : config.providerType === 'artifact-bundle'
                      ? 'integration://artifact/catalog'
                      : 'integration://manual/upload',
            defaultConfig: {
              ...config.providerConfig,
            },
          },
        ]
      })

      return [projectId, Object.fromEntries(entries)]
    }),
  )
