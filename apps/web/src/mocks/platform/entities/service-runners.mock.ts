import { MOCK_SERVICE_CONFIGS_BY_PROJECT } from './service-configs.mock'
import type { MockServiceRunner } from '../types'

function inferRunnerName(type: MockServiceRunner['type']) {
  switch (type) {
    case 'docker-compose':
      return 'Docker Compose Runner'
    case 'docker-swarm':
      return 'Docker Swarm Runner'
    case 'kubernetes':
      return 'Kubernetes Runner'
    case 'nomad':
      return 'Nomad Runner'
    case 'worker-runtime':
      return 'Worker Runtime Runner'
    case 'static':
      return 'Static Asset Runner'
    default:
      return 'Generic Runner'
  }
}

function inferPool(type: MockServiceRunner['type']) {
  switch (type) {
    case 'kubernetes':
      return 'pool-k8s-main'
    case 'docker-compose':
      return 'pool-docker-compose'
    case 'docker-swarm':
      return 'pool-swarm'
    case 'nomad':
      return 'pool-nomad'
    case 'worker-runtime':
      return 'pool-workers'
    case 'static':
      return 'pool-static'
    default:
      return 'pool-default'
  }
}

export const MOCK_SERVICE_RUNNERS_BY_PROJECT: Record<string, Record<string, MockServiceRunner>> =
  Object.fromEntries(
    Object.entries(MOCK_SERVICE_CONFIGS_BY_PROJECT).map(([projectId, serviceConfigs]) => {
      const entries = Object.entries(serviceConfigs).map(([serviceId, config]) => {
        const runnerId = `runner-${serviceId}`

        return [
          serviceId,
          {
            id: runnerId,
            projectId,
            serviceId,
            type: config.runnerType,
            name: inferRunnerName(config.runnerType),
            pool: inferPool(config.runnerType),
            defaultConfig: {
              ...config.runnerConfig,
            },
          },
        ]
      })

      return [projectId, Object.fromEntries(entries)]
    }),
  )
