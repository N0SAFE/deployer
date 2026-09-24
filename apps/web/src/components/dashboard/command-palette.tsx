'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AuthDashboardProjectsProjectId,
  AuthDashboardProjectsProjectIdServicesServiceId,
} from '@/routes'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@repo/ui/components/shadcn/command'
import { FolderKanban, Server, type LucideIcon } from 'lucide-react'
import { useProjectList } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useSession } from '@/lib/auth'
import { NAV_GROUPS } from './navigation'
import { subscribeCommandPalette } from './command-palette-store'

interface PaletteEntry {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  href: string
  shortcut?: string
  keywords?: string
}

/**
 * The palette's navigation section, flattened from the shared navigation model.
 *
 * Flattened rather than written out here, because this list used to duplicate
 * the sidebar's catalogue and drifted from it: the two surfaces offered the
 * same pages under different names. The group label is kept as a prefix because
 * the palette draws no group headers — without it, "Containers" is
 * indistinguishable from any other container-flavoured result.
 */
function navigationEntries(isAdmin: boolean): PaletteEntry[] {
  return NAV_GROUPS.filter((group) => group.adminOnly !== true || isAdmin).flatMap(
    (group) =>
      group.items.map((item) => ({
        id: `nav:${group.id}:${item.url}`,
        label: `${group.label} · ${item.title}`,
        hint: item.hint,
        icon: item.icon,
        href: item.url,
        shortcut: item.shortcut,
        keywords: `${item.keywords ?? ''} ${group.label}`.trim(),
      })),
  )
}

/** Substring-in-order fuzzy match (same matcher as the sidebar). */
function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
    if (lower[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface ProjectLike {
  id: string
  name?: string | null
}
interface ServiceLike {
  id: string
  name?: string | null
  projectId?: string | null
  project_id?: string | null
}

/**
 * CommandPalette — the operator's keyboard. ⌘K opens it; type to fuzzy-search
 * routes, projects, and services; ↑↓ to move; ↵ to jump. Registered once in
 * the dashboard layout.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data: session } = useSession()
  // Mirrors the rail's gate: someone who cannot see the Admin Panel in the
  // sidebar should not be offered its pages by search either.
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'superAdmin'
  const navEntries = useMemo(() => navigationEntries(isAdmin), [isAdmin])

  const { data: projectsData } = useProjectList({ query: { limit: 100, offset: 0 } })
  const { data: servicesData } = useServiceList({ query: { limit: 100, offset: 0 } })

  // Memoised on the query result, not rebuilt per render: these feed the
  // `useMemo`s below, and a new array identity every render would make those
  // recompute on every keystroke for no reason.
  const projects = useMemo(
    () => (projectsData as { data?: ProjectLike[] } | undefined)?.data ?? [],
    [projectsData],
  )
  const services = useMemo(
    () =>
      ((servicesData as { data?: ServiceLike[] } | undefined)?.data ?? []).filter(
        (s) =>
          s.projectId !== null &&
          s.projectId !== undefined &&
          s.project_id !== null &&
          s.project_id !== undefined,
      ),
    [servicesData],
  )

  useEffect(
    () =>
      subscribeCommandPalette(() => {
        setOpen(true)
      }),
    [],
  )

  const filteredNav = useMemo(() => {
    if (!query.trim()) return navEntries
    return navEntries.filter((entry) =>
      fuzzyMatch(`${entry.label} ${entry.hint ?? ''} ${entry.keywords ?? ''}`, query),
    )
  }, [query, navEntries])

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projects.slice(0, 6)
    return projects.filter((p) => fuzzyMatch(`${p.name ?? ''} ${p.id}`, query)).slice(0, 6)
  }, [projects, query])

  const filteredServices = useMemo(() => {
    if (!query.trim()) return services.slice(0, 6)
    return services.filter((s) => fuzzyMatch(`${s.name ?? ''} ${s.id}`, query)).slice(0, 6)
  }, [services, query])

  const noResults =
    filteredNav.length === 0 && filteredProjects.length === 0 && filteredServices.length === 0

  const go = (href: string) => {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command center" description="Jump to any page, project, or service">
      <CommandInput
        placeholder="Search pages, projects, services…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-105">
        {noResults ? (
          <CommandEmpty className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No results for “{query}”</p>
            <p className="text-xs text-muted-foreground">Try a page name (projects, docker), a project, or a service.</p>
          </CommandEmpty>
        ) : null}

        {filteredNav.length > 0 ? (
          <CommandGroup heading="Pages">
            {filteredNav.map((entry) => (
              <CommandItem
                key={entry.id}
                value={entry.id}
                onSelect={() => {
                  go(entry.href)
                }}
              >
                <entry.icon className="size-4" />
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.hint ? <span className="mr-1 truncate text-xs text-muted-foreground">{entry.hint}</span> : null}
                {entry.shortcut ? <CommandShortcut>{entry.shortcut}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredProjects.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {filteredProjects.map((project) => {
                const name = project.name ?? project.id
                return (
                  <CommandItem
                    key={`project:${project.id}`}
                    value={`project:${project.id}`}
                    onSelect={() => {
                      go(AuthDashboardProjectsProjectId({ projectId: project.id }))
                    }}
                  >
                    <FolderKanban className="size-4" />
                    <span className="flex-1 truncate">{name}</span>
                    <span className="mr-1 text-xs text-muted-foreground">project</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        ) : null}

        {filteredServices.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Services">
              {filteredServices.map((service) => {
                const name = service.name ?? service.id
                const projectId = service.projectId ?? service.project_id ?? ''
                return (
                  <CommandItem
                    key={`service:${service.id}`}
                    value={`service:${service.id}`}
                    onSelect={() => {
                      go(
                        AuthDashboardProjectsProjectIdServicesServiceId({
                          projectId,
                          serviceId: service.id,
                        }),
                      )
                    }}
                  >
                    <Server className="size-4" />
                    <span className="flex-1 truncate">{name}</span>
                    <span className="mr-1 text-xs text-muted-foreground">service</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-3">
          <span><kbd className="rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 font-sans">↵</kbd> open</span>
          <span><kbd className="rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 font-sans">esc</kbd> close</span>
        </span>
        <span>g + letter to jump</span>
      </div>
    </CommandDialog>
  )
}
