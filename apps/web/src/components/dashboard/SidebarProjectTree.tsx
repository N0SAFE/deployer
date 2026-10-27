'use client'

import { useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Plus, Search } from 'lucide-react'
import {
  AuthDashboardProjects,
  AuthDashboardProjectsProjectId,
  AuthDashboardProjectsProjectIdServicesServiceId,
} from '@/routes'
import { useProjectList } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import {
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@deployer/ui/components/shadcn/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@deployer/ui/components/shadcn/collapsible'
import { fuzzyMatch } from './fuzzy'

interface NamedRow {
  id: string
  name: string
}
interface ServiceRow extends NamedRow {
  parentId?: string | null
  parent_id?: string | null
  projectId?: string
  project_id?: string
}

/** Show the filter box only once the list is long enough to need one. */
const FILTER_THRESHOLD = 6

/**
 * The live project list, drawn under the Workloads entries.
 *
 * It is a labelled sub-section ("Your projects"), not a second navigation
 * entry: the "Projects" entry above opens the list page, this tree jumps
 * straight into one project or service. The row name is a link; the chevron
 * only expands its services.
 */
export function SidebarProjectTree() {
  const pathname = usePathname()
  const [projectFilter, setProjectFilter] = useState('')
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  const { data: projectsData, isPending } = useProjectList({ query: { limit: 50, offset: 0 } })
  const { data: servicesData } = useServiceList({ query: { limit: 50, offset: 0 } })

  const allProjects = useMemo(
    () => (projectsData as { data?: NamedRow[] } | undefined)?.data ?? [],
    [projectsData],
  )
  const projects = useMemo(
    () => (projectFilter ? allProjects.filter((p) => fuzzyMatch(p.name, projectFilter)) : allProjects),
    [allProjects, projectFilter],
  )
  const services = useMemo(
    () => (servicesData as { data?: ServiceRow[] } | undefined)?.data ?? [],
    [servicesData],
  )

  // The project that owns the current route stays expanded.
  const activeProjectId = /^\/dashboard\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null
  const openProject = expandedProject ?? activeProjectId

  return (
    <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-3">
        <span className="text-xs font-medium text-sidebar-foreground/70">
          Your projects{allProjects.length > 0 ? ` (${String(allProjects.length)})` : ''}
        </span>
        <AuthDashboardProjects.Link
          aria-label="New project"
          title="New project — opens the Projects page"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Plus className="size-3.5" aria-hidden />
          New
        </AuthDashboardProjects.Link>
      </div>

      {allProjects.length >= FILTER_THRESHOLD ? (
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={filterInputRef}
              aria-label="Filter projects"
              placeholder="Filter projects…"
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value)
              }}
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 pl-7 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      ) : null}

      {isPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">Loading projects…</p>
      ) : allProjects.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet. Create one to see it here.</p>
      ) : projects.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">No project matches “{projectFilter}”.</p>
      ) : (
        <SidebarMenuSub className="mx-2 px-1.5">
          {projects.map((project) => {
            const projectServices = services.filter(
              (s) =>
                (s.projectId === project.id || s.project_id === project.id) &&
                s.parentId == null &&
                s.parent_id == null,
            )
            const href = AuthDashboardProjectsProjectId({ projectId: project.id })
            return (
              <Collapsible
                key={project.id}
                open={openProject === project.id}
                onOpenChange={(next) => {
                  setExpandedProject(next ? project.id : '')
                }}
                className="group/sub"
              >
                <SidebarMenuSubItem>
                  <div className="flex items-center">
                    <SidebarMenuSubButton asChild isActive={pathname === href} className="min-w-0 flex-1">
                      <Link href={href} title={project.name}>
                        <span className="truncate">{project.name}</span>
                      </Link>
                    </SidebarMenuSubButton>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Toggle services of ${project.name}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                      >
                        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/sub:rotate-90" aria-hidden />
                      </button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <SidebarMenuSub className="mx-2 px-1.5">
                      {projectServices.length === 0 ? (
                        <li className="px-2 py-1 text-xs text-muted-foreground">No services yet</li>
                      ) : (
                        projectServices.map((svc) => {
                          const svcHref = AuthDashboardProjectsProjectIdServicesServiceId({
                            projectId: project.id,
                            serviceId: svc.id,
                          })
                          return (
                            <SidebarMenuSubItem key={svc.id}>
                              <SidebarMenuSubButton asChild isActive={pathname === svcHref}>
                                <Link href={svcHref} title={svc.name}>
                                  <span className="truncate">{svc.name}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          )
                        })
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuSubItem>
              </Collapsible>
            )
          })}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}
