'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AuthDashboard,
  AuthDashboardAdminDomains,
  AuthDashboardAdminProviders,
  AuthDashboardAdminSystem,
  AuthDashboardAdminUsers,
  AuthDashboardConfiguration,
  AuthDashboardDeployments,
  AuthDashboardDocker,
  AuthDashboardDockerActivity,
  AuthDashboardDockerContainers,
  AuthDashboardDockerImages,
  AuthDashboardDockerLogs,
  AuthDashboardDockerNetworks,
  AuthDashboardDockerRegistry,
  AuthDashboardDockerShell,
  AuthDashboardDockerStacks,
  AuthDashboardDockerVolumes,
  AuthDashboardNodes,
  AuthDashboardProfile,
  AuthDashboardProjects,
  AuthDashboardProjectsProjectId,
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardServices,
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
import {
  Container,
  FolderKanban,
  Globe,
  LayoutDashboard,
  Rocket,
  Server,
  Settings,
  UserCircle2,
  Users,
  GitFork,
  Activity,
  Boxes,
  Layers,
  Network,
  HardDrive,
  ScrollText,
  TerminalSquare,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useProjectList } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
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
 * Static navigation catalog — every dashboard destination, with the same
 * vocabulary as the sidebar. `href` is resolved through the typed route
 * builders so navigation never hardcodes paths.
 */
const NAV_ENTRIES: PaletteEntry[] = [
  { id: 'nav:overview', label: 'Command center', hint: 'Dashboard overview', icon: LayoutDashboard, href: AuthDashboard(), shortcut: 'g o', keywords: 'home overview dashboard start' },
  { id: 'nav:projects', label: 'Projects', hint: 'All projects', icon: FolderKanban, href: AuthDashboardProjects(), shortcut: 'g p', keywords: 'folders infrastructure apps' },
  { id: 'nav:deployments', label: 'Deployments', hint: 'Timeline & rollouts', icon: Rocket, href: AuthDashboardDeployments(), shortcut: 'g d', keywords: 'rollout release timeline' },
  { id: 'nav:services', label: 'Services', hint: 'Service inventory', icon: Server, href: AuthDashboardServices(), shortcut: 'g s', keywords: 'runners instances health' },
  { id: 'nav:docker', label: 'Docker', hint: 'Container operations', icon: Container, href: AuthDashboardDocker(), shortcut: 'g c', keywords: 'containers images runtime' },
  { id: 'nav:docker-containers', label: 'Docker · Containers', icon: Boxes, href: AuthDashboardDockerContainers(), keywords: 'container list runtime' },
  { id: 'nav:docker-images', label: 'Docker · Images', icon: Layers, href: AuthDashboardDockerImages(), keywords: 'images registry builds' },
  { id: 'nav:docker-networks', label: 'Docker · Networks', icon: Network, href: AuthDashboardDockerNetworks(), keywords: 'networks bridge overlay' },
  { id: 'nav:docker-volumes', label: 'Docker · Volumes', icon: HardDrive, href: AuthDashboardDockerVolumes(), keywords: 'volumes storage mounts' },
  { id: 'nav:docker-stacks', label: 'Docker · Stacks', icon: Layers, href: AuthDashboardDockerStacks(), keywords: 'stacks compose services' },
  { id: 'nav:docker-registry', label: 'Docker · Registry', icon: HardDrive, href: AuthDashboardDockerRegistry(), keywords: 'registry credentials' },
  { id: 'nav:docker-activity', label: 'Docker · Activity', icon: Activity, href: AuthDashboardDockerActivity(), keywords: 'activity events log' },
  { id: 'nav:docker-logs', label: 'Docker · Logs', icon: ScrollText, href: AuthDashboardDockerLogs(), keywords: 'logs streaming output' },
  { id: 'nav:docker-shell', label: 'Docker · Shell', icon: TerminalSquare, href: AuthDashboardDockerShell(), keywords: 'shell terminal exec' },
  { id: 'nav:nodes', label: 'Nodes', hint: 'Fleet, allocation & topology', icon: Server, href: AuthDashboardNodes(), shortcut: 'g n', keywords: 'nodes fleet servers mesh topology' },
  { id: 'nav:configuration', label: 'Configuration', hint: 'Mesh-wide & per-node settings', icon: SlidersHorizontal, href: AuthDashboardConfiguration(), keywords: 'configuration settings node mesh' },

  { id: 'nav:admin-users', label: 'Admin · Users', icon: Users, href: AuthDashboardAdminUsers(), keywords: 'users roles permissions' },
  { id: 'nav:admin-domains', label: 'Admin · Domains', icon: Globe, href: AuthDashboardAdminDomains(), keywords: 'domains dns verify' },
  { id: 'nav:admin-providers', label: 'Admin · Providers', icon: GitFork, href: AuthDashboardAdminProviders(), keywords: 'providers code dns cloudflare' },
  { id: 'nav:admin-system', label: 'Admin · System', hint: 'Control plane', icon: Settings, href: AuthDashboardAdminSystem(), shortcut: 'g a', keywords: 'system mesh fleet readiness' },
  { id: 'nav:profile', label: 'Profile', hint: 'Account settings', icon: UserCircle2, href: AuthDashboardProfile(), shortcut: 'g u', keywords: 'account user settings' },
]

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

  const { data: projectsData } = useProjectList({ query: { limit: 100, offset: 0 } })
  const { data: servicesData } = useServiceList({ query: { limit: 100, offset: 0 } })

  const projects = (projectsData as { data?: ProjectLike[] } | undefined)?.data ?? []
  const services = ((servicesData as { data?: ServiceLike[] } | undefined)?.data ?? []).filter(
    (s) => s.projectId !== null && s.projectId !== undefined && s.project_id !== null && s.project_id !== undefined,
  )

  useEffect(() => subscribeCommandPalette(() => setOpen(true)), [])

  const filteredNav = useMemo(() => {
    if (!query.trim()) return NAV_ENTRIES
    return NAV_ENTRIES.filter((entry) =>
      fuzzyMatch(`${entry.label} ${entry.hint ?? ''} ${entry.keywords ?? ''}`, query),
    )
  }, [query])

  const filteredProjects = useMemo(() => {
    const source = projects as ProjectLike[]
    if (!query.trim()) return source.slice(0, 6)
    return source.filter((p) => fuzzyMatch(`${p.name ?? ''} ${p.id}`, query)).slice(0, 6)
  }, [projects, query])

  const filteredServices = useMemo(() => {
    const source = services as ServiceLike[]
    if (!query.trim()) return source.slice(0, 6)
    return source.filter((s) => fuzzyMatch(`${s.name ?? ''} ${s.id}`, query)).slice(0, 6)
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
              <CommandItem key={entry.id} value={entry.id} onSelect={() => go(entry.href)}>
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
                  <CommandItem key={`project:${project.id}`} value={`project:${project.id}`} onSelect={() => go(AuthDashboardProjectsProjectId({ projectId: project.id }))}>
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
                    onSelect={() => go(AuthDashboardProjectsProjectIdServicesServiceId({ projectId, serviceId: service.id }))}
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
