import type { DockerRuntimeActivityEntity } from '@deployer/contracts-entities'
import type { StatusBadgeVariant } from '@/components/dashboard'

/** Severity is its own axis (how bad an EVENT was), so it maps straight to a badge variant. */
export function severityVariant(severity: DockerRuntimeActivityEntity['severity']): StatusBadgeVariant {
  if (severity === 'error') return 'destructive'
  if (severity === 'warning') return 'warning'
  return 'outline'
}
