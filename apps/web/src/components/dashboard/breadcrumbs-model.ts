export interface BreadcrumbConfig {
  label: string
  href: string
  /** Dynamic id rendered with a mono face (no name could be resolved). */
  mono?: boolean
}

/** Path segment → label. Add entries to rename a crumb. */
export const pathLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  deployments: 'Deployments',
  // `/dashboard/admin/providers/*` keeps its URL (GitHub callbacks are registered
  // against it) but reads as part of Settings.
  admin: 'Settings',
  providers: 'Integrations',
  users: 'Users & access',
  account: 'Account',
  node: 'This node',
  security: 'Security',
  capacity: 'Capacity & admissions',
  diagnostics: 'Peer diagnostics',
  demo: 'Demo',
  settings: 'Settings',
  projects: 'Projects',
  docker: 'Docker',
  containers: 'Containers',
  logs: 'Logs',
  shell: 'Shell',
  images: 'Images',
  volumes: 'Volumes',
  networks: 'Networks',
  stacks: 'Stacks',
  registry: 'Registry',
  activity: 'Activity',
  events: 'Activity',
  terminal: 'Shell',
  network: 'Network',
  ingress: 'Ingress & edge',
  mesh: 'Mesh',
  dns: 'DNS',
  domains: 'Domains',
  nodes: 'Nodes',
  cluster: 'Cluster',
}

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const HEX24_RE = /^[a-f0-9]{24}$/i

export function looksLikeId(segment: string): boolean {
  return UUID_RE.test(segment) || HEX24_RE.test(segment)
}

/** Kebab/camel → Title Case, for segments with no explicit label. */
export function titleCase(segment: string): string {
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Neutral, compact stand-in for an id whose name is not (yet) known. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/**
 * Names for dynamic segments: `kind` is the preceding static segment
 * ("projects", "services", "nodes"), `id` the segment itself.
 */
export type NameResolver = (kind: string, id: string) => string | undefined

/**
 * Build the trail for a pathname. Dynamic ids resolve to a name when the
 * resolver knows one, otherwise to a neutral short id — never to nothing — and
 * consecutive crumbs with the same label collapse (e.g. Settings > Settings).
 */
export function buildBreadcrumbs(pathname: string, resolve?: NameResolver): BreadcrumbConfig[] {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: BreadcrumbConfig[] = []
  segments.forEach((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/')
    const known = pathLabels[segment.toLowerCase()]
    let crumb: BreadcrumbConfig
    if (known) {
      crumb = { label: known, href }
    } else if (looksLikeId(segment) || (index > 0 && segments[index - 1] !== 'dashboard' && /\d/.test(segment) && segment.length >= 12)) {
      const name = resolve?.(segments[index - 1] ?? '', segment)
      crumb = name ? { label: name, href } : { label: shortId(segment), href, mono: true }
    } else {
      crumb = { label: titleCase(segment), href }
    }
    if (crumbs.at(-1)?.label === crumb.label) {
      // Same label twice in a row: keep the deeper link.
      crumbs[crumbs.length - 1] = crumb
    } else {
      crumbs.push(crumb)
    }
  })
  return crumbs
}
