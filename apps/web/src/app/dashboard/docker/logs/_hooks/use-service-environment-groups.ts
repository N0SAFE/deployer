import { useMemo } from 'react'
import { type ServiceEnvironmentGroup, type ServiceEnvironmentNode } from '../_models/logs.types'

interface ContainerLike {
  name: string
  serviceId: string | null
  environment: string | null
}

export function useServiceEnvironmentGroups(
  containerEntities: ContainerLike[],
  serviceNameById: Map<string, string>,
  containerSearchTerm: string,
) {
  const serviceEnvironmentGroups = useMemo<ServiceEnvironmentGroup[]>(() => {
    const grouped = new Map<string, { serviceId: string; serviceName: string; environments: Map<string, string[]> }>()

    for (const container of containerEntities) {
      const containerName = container.name
      if (!containerName) continue

      const serviceId = container.serviceId ?? 'unknown-service'
      const serviceName = serviceNameById.get(serviceId) ?? serviceId
      const environment = container.environment ?? 'unknown'
      const key = `${serviceId}:${serviceName}`

      const current = grouped.get(key) ?? {
        serviceId,
        serviceName,
        environments: new Map<string, string[]>(),
      }

      const environmentContainers = current.environments.get(environment) ?? []
      environmentContainers.push(containerName)
      current.environments.set(environment, environmentContainers)

      grouped.set(key, current)
    }

    const tree = Array.from(grouped.values())
      .map((group) => {
        const environments = Array.from(group.environments.entries())
          .map(([environment, containers]) => ({
            environment,
            containers: Array.from(new Set(containers)).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.environment.localeCompare(b.environment))

        return {
          serviceId: group.serviceId,
          serviceName: group.serviceName,
          environments,
          containers: environments.flatMap((environmentGroup) => environmentGroup.containers),
        }
      })
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName))

    const normalized = containerSearchTerm.trim().toLowerCase()
    if (!normalized) {
      return tree
    }

    return tree
      .map((group) => {
        const serviceMatches =
          group.serviceName.toLowerCase().includes(normalized)
          || group.serviceId.toLowerCase().includes(normalized)

        const environments = group.environments
          .map((environmentGroup) => {
            if (serviceMatches) {
              return environmentGroup
            }

            const environmentMatches = environmentGroup.environment.toLowerCase().includes(normalized)
            if (environmentMatches) {
              return environmentGroup
            }

            const matchedContainers = environmentGroup.containers.filter((containerName) =>
              containerName.toLowerCase().includes(normalized),
            )

            if (matchedContainers.length === 0) {
              return null
            }

            return {
              environment: environmentGroup.environment,
              containers: matchedContainers,
            }
          })
          .filter((environmentGroup): environmentGroup is ServiceEnvironmentNode => environmentGroup !== null)

        if (!serviceMatches && environments.length === 0) {
          return null
        }

        return {
          ...group,
          environments,
          containers: environments.flatMap((environmentGroup) => environmentGroup.containers),
        }
      })
      .filter((group): group is ServiceEnvironmentGroup => group !== null)
  }, [containerEntities, containerSearchTerm, serviceNameById])

  const visibleContainerNames = useMemo(() => {
    return serviceEnvironmentGroups.flatMap((group) => group.containers)
  }, [serviceEnvironmentGroups])

  return {
    serviceEnvironmentGroups,
    visibleContainerNames,
  }
}
