import { useQuery } from '@tanstack/react-query'
import {
  MOCK_DOCKER_DEPLOYMENTS,
  MOCK_DOCKER_FLEET_SERVERS,
  MOCK_DOCKER_MESH_EVENT_STREAMS,
  MOCK_DOCKER_MESH_STATE,
  MOCK_DOCKER_SERVICES,
} from '@/mocks/platform/entities/docker.mock'
import {
  MOCK_DOCKER_CONTAINERS_REALISTIC,
  MOCK_DOCKER_IMAGES_REALISTIC,
  MOCK_DOCKER_NETWORKS_REALISTIC,
  MOCK_DOCKER_REGISTRIES_REALISTIC,
  MOCK_DOCKER_STACKS_REALISTIC,
  MOCK_DOCKER_VOLUMES_REALISTIC,
} from '@/mocks/platform/entities/docker.large.mock'
import type {
  DockerContainer,
  DockerContainerList,
  DockerDeploymentList,
  DockerFleetServerList,
  DockerImage,
  DockerImageList,
  DockerMeshEventStreamList,
  DockerNetwork,
  DockerNetworkList,
  DockerRegistry,
  DockerRegistryList,
  DockerServiceList,
  DockerStack,
  DockerStackList,
  DockerVolume,
  DockerVolumeList,
} from '@repo/contracts-entities'

interface QueryPagination {
  limit?: number
  offset?: number
}

interface QueryInput {
  query?: QueryPagination
}

function applyPagination<T>(items: T[], input?: QueryInput): T[] {
  const limit = input?.query?.limit ?? items.length
  const offset = input?.query?.offset ?? 0
  return items.slice(offset, offset + limit)
}

export function useDockerDeploymentList(input?: QueryInput) {
  return useQuery<DockerDeploymentList>({
    queryKey: ['docker', 'mock', 'deployments', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_DEPLOYMENTS, input),
      meta: {
        total: MOCK_DOCKER_DEPLOYMENTS.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_DEPLOYMENTS.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerServiceList(input?: QueryInput) {
  return useQuery<DockerServiceList>({
    queryKey: ['docker', 'mock', 'services', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_SERVICES, input),
      meta: {
        total: MOCK_DOCKER_SERVICES.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_SERVICES.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerFleetServers() {
  return useQuery<DockerFleetServerList>({
    queryKey: ['docker', 'mock', 'fleet', 'servers'],
    queryFn: () => ({
      items: MOCK_DOCKER_FLEET_SERVERS,
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerMeshEventStreams(input?: QueryInput) {
  return useQuery<DockerMeshEventStreamList>({
    queryKey: ['docker', 'mock', 'mesh', 'streams', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_MESH_EVENT_STREAMS, input),
      meta: {
        total: MOCK_DOCKER_MESH_EVENT_STREAMS.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_MESH_EVENT_STREAMS.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerMeshSseState() {
  return {
    status: 'connected' as const,
    lastError: null,
    state: MOCK_DOCKER_MESH_STATE,
  }
}

export function useDockerContainerList(input?: QueryInput) {
  return useQuery<DockerContainerList>({
    queryKey: ['docker', 'mock', 'containers', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_CONTAINERS_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_CONTAINERS_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_CONTAINERS_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerImageList(input?: QueryInput) {
  return useQuery<DockerImageList>({
    queryKey: ['docker', 'mock', 'images', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_IMAGES_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_IMAGES_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_IMAGES_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerNetworkList(input?: QueryInput) {
  return useQuery<DockerNetworkList>({
    queryKey: ['docker', 'mock', 'networks', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_NETWORKS_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_NETWORKS_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_NETWORKS_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerVolumeList(input?: QueryInput) {
  return useQuery<DockerVolumeList>({
    queryKey: ['docker', 'mock', 'volumes', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_VOLUMES_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_VOLUMES_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_VOLUMES_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerRegistryList(input?: QueryInput) {
  return useQuery<DockerRegistryList>({
    queryKey: ['docker', 'mock', 'registries', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_REGISTRIES_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_REGISTRIES_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_REGISTRIES_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export function useDockerStackList(input?: QueryInput) {
  return useQuery<DockerStackList>({
    queryKey: ['docker', 'mock', 'stacks', input],
    queryFn: () => ({
      data: applyPagination(MOCK_DOCKER_STACKS_REALISTIC, input),
      meta: {
        total: MOCK_DOCKER_STACKS_REALISTIC.length,
        limit: input?.query?.limit ?? MOCK_DOCKER_STACKS_REALISTIC.length,
        offset: input?.query?.offset ?? 0,
      },
    }),
    staleTime: 1000 * 60 * 5,
  })
}

export type DockerEntityKind = 'containers' | 'images' | 'networks' | 'volumes' | 'registry' | 'stacks'

export interface DockerEntityDetailPayload {
  container?: DockerContainer
  image?: DockerImage
  network?: DockerNetwork
  volume?: DockerVolume
  registry?: DockerRegistry
  stack?: DockerStack
}

export function getDockerEntityDetail(kind: DockerEntityKind, id: string): DockerEntityDetailPayload {
  switch (kind) {
    case 'containers':
      return { container: MOCK_DOCKER_CONTAINERS_REALISTIC.find((entity) => entity.id === id) }
    case 'images':
      return { image: MOCK_DOCKER_IMAGES_REALISTIC.find((entity) => entity.id === id) }
    case 'networks':
      return { network: MOCK_DOCKER_NETWORKS_REALISTIC.find((entity) => entity.id === id) }
    case 'volumes':
      return { volume: MOCK_DOCKER_VOLUMES_REALISTIC.find((entity) => entity.id === id) }
    case 'registry':
      return { registry: MOCK_DOCKER_REGISTRIES_REALISTIC.find((entity) => entity.id === id) }
    case 'stacks':
      return { stack: MOCK_DOCKER_STACKS_REALISTIC.find((entity) => entity.id === id) }
    default:
      return {}
  }
}
