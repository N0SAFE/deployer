import type { ContainerSortKey } from './_models/container-list.model'

/** Table column metadata: header label, the sort key it maps to (if sortable) and its width class. */
export interface ContainerColumn {
  id: 'name' | 'image' | 'status' | 'ports' | 'environment' | 'service' | 'updated'
  label: string
  sortKey?: ContainerSortKey
  className?: string
}

export const CONTAINER_COLUMNS: readonly ContainerColumn[] = [
  { id: 'name', label: 'Container', sortKey: 'name', className: 'min-w-48' },
  { id: 'image', label: 'Image', sortKey: 'image', className: 'min-w-48' },
  { id: 'status', label: 'Status', sortKey: 'status', className: 'min-w-36' },
  { id: 'ports', label: 'Ports', className: 'min-w-28' },
  { id: 'environment', label: 'Environment', sortKey: 'environment' },
  { id: 'service', label: 'Service' },
  { id: 'updated', label: 'Updated', sortKey: 'updated', className: 'text-right' },
]
