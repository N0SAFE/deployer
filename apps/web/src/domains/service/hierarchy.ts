/**
 * Service hierarchy helpers.
 *
 * A sub-service is a REAL service row linked to its parent via `parentId`
 * (it may itself have children — full nesting). Project-level views must
 * show only the TOP-LEVEL ("main") services; sub-services are surfaced
 * inside their parent's detail page (ServiceChildrenTree).
 */

/** Minimal shape the hierarchy helpers rely on. */
export interface ServiceHierarchyFields {
  id: string
  projectId?: string | null
  project_id?: string | null
  parentId?: string | null
  parent_id?: string | null
}

/** True when the service is a top-level ("main") service of its project. */
export function isTopLevelService(service: ServiceHierarchyFields): boolean {
  return service.parentId == null && service.parent_id == null
}

/**
 * Filter a service list down to the top-level services of ONE project.
 * Sub-services (rows with a `parentId`) are excluded so they never render
 * as if they were main services in project-level views.
 */
export function filterProjectTopLevelServices<T extends ServiceHierarchyFields>(
  services: T[],
  projectId: string | undefined | null,
): T[] {
  return services.filter((s) => {
    const belongs =
      s.projectId === projectId || s.project_id === projectId
    return belongs && isTopLevelService(s)
  })
}

/** Filter a service list down to top-level services only (any project). */
export function filterTopLevelServices<T extends ServiceHierarchyFields>(
  services: T[],
): T[] {
  return services.filter(isTopLevelService)
}
