import { useMemo } from 'react'
import { useDockerImageList, useDockerNetworkList } from '@/domains/docker/hooks'
import { fuzzyScore } from './pull-scan.model'

const LIST_INPUT = { query: { limit: 200, offset: 0 } } as const

export interface ImageSuggestion {
  id: string
  tag: string
  repositoryBase: string
  imageRef: string
}

/** Images and networks already known to the node's engine, plus the fuzzy-matched suggestions for `image`. */
export function useImageCatalog(image: string) {
  const imagesQuery = useDockerImageList(LIST_INPUT)
  const networksQuery = useDockerNetworkList(LIST_INPUT)
  const imageEntities = useMemo(() => imagesQuery.data?.data ?? [], [imagesQuery.data])
  const networks = useMemo(() => networksQuery.data?.data ?? [], [networksQuery.data])

  const selectedImageEntity = useMemo(() => {
    const normalized = image.trim().toLowerCase()
    if (!normalized) return null
    return imageEntities.find((entity) => {
      const repositoryRef = `${entity.registry}/${entity.repository}`.toLowerCase()
      return normalized === `${repositoryRef}:${entity.tag ?? 'latest'}`.toLowerCase() || normalized === repositoryRef
    }) ?? null
  }, [image, imageEntities])

  const catalog = useMemo<ImageSuggestion[]>(() => imageEntities.map((entity) => {
    const tag = entity.tag ?? 'latest'
    const repositoryBase = `${entity.registry}/${entity.repository}`
    return { id: entity.id, tag, repositoryBase, imageRef: `${repositoryBase}:${tag}` }
  }), [imageEntities])

  const suggestions = useMemo(() => {
    const query = image.trim()
    if (!query) return catalog.slice(0, 12)
    return catalog
      .map((item) => ({ item, score: fuzzyScore(query, item.imageRef) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.item)
  }, [image, catalog])

  const networkOptions = useMemo(() => networks.map((network) => ({
    value: network.id,
    label: network.name,
    description: `${network.driver} • ${network.scope} • ${network.subnet ?? 'no subnet'}`,
  })), [networks])

  return {
    selectedImageEntity,
    suggestions,
    networkOptions,
    catalogLoading: imagesQuery.isLoading,
    catalogError: imagesQuery.isError,
    refetchCatalog: () => { void imagesQuery.refetch() },
  }
}
