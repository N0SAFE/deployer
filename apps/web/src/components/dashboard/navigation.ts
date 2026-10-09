import {
  Activity,
  Boxes,
  Container,
  FolderKanban,
  GitFork,
  Globe,
  HardDrive,
  Image as ImageIcon,
  LayoutDashboard,
  Network,
  Rocket,
  Route as RouteIcon,
  ScrollText,
  Server,
  ServerCog,
  Settings,
  ShieldCheck,
  TerminalSquare,
  UserCircle,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import {
  AuthDashboard,
  AuthDashboardAdminProviders,
  AuthDashboardAdminProvidersCode,
  AuthDashboardAdminProvidersCodeDockerHub,
  AuthDashboardAdminProvidersCodeGithub,
  AuthDashboardAdminProvidersCodeGitlab,
  AuthDashboardAdminProvidersDns,
  AuthDashboardAdminProvidersDnsCloudflare,
  AuthDashboardAdminProvidersDnsGoogleDns,
  AuthDashboardAdminProvidersDnsRoute53,
  AuthDashboardCluster,
  AuthDashboardDeployments,
  AuthDashboardDocker,
  AuthDashboardDockerActivity,
  AuthDashboardDockerContainers,
  AuthDashboardDockerImages,
  AuthDashboardDockerLogs,
  AuthDashboardDockerNetworks,
  AuthDashboardDockerShell,
  AuthDashboardDockerVolumes,
  AuthDashboardNetwork,
  AuthDashboardNetworkDns,
  AuthDashboardNetworkDomains,
  AuthDashboardNetworkIngress,
  AuthDashboardNetworkMesh,
  AuthDashboardNodes,
  AuthDashboardProjects,
  AuthDashboardSettings,
  AuthDashboardSettingsAccount,
  AuthDashboardSettingsNode,
  AuthDashboardSettingsSecurity,
  AuthDashboardSettingsUsers,
  AuthDashboardServices,
  DashboardAnalytics,
} from '@/routes'

export interface NavSubItem {
  title: string
  /** Produced by a typed route builder, so a renamed route fails to compile. */
  url: string
}

export interface NavItem {
  title: string
  /** Produced by a typed route builder. See `NavSubItem.url`. */
  url: string
  icon: LucideIcon
  /**
   * Match only this entry's own path.
   *
   * Needed wherever a sibling is also nested under the same prefix: without it,
   * opening `/dashboard/docker/containers` left both Engine and Containers
   * highlighted, which is the ambiguity that made the old "Overview" labels
   * impossible to disambiguate from the rail alone.
   */
  exact?: boolean
  /** Hidden from non-admin sessions, in the rail AND in search. */
  adminOnly?: boolean
  /** Rendered as a nested `SidebarMenuSub`. */
  items?: NavSubItem[]
  /** Command-palette subtitle. */
  hint?: string
  /** Command-palette chord. */
  shortcut?: string
  /** Extra terms the command palette matches on, beyond the title and hint. */
  keywords?: string
}

export type NavGroupId =
  | 'platform'
  | 'network'
  | 'workloads'
  | 'observability'
  | 'engine'
  | 'settings'

export interface NavGroup {
  /** Stable key. Presentation branches on this, never on the label. */
  id: NavGroupId
  label: string
  icon: LucideIcon
  /** Hidden from non-admin sessions, in the rail AND in search. */
  adminOnly?: boolean
  /**
   * The rail draws the live project tree after this group's entries. Command
   * surfaces skip it — they resolve projects from the API themselves, because
   * they must also match projects the rail has not loaded.
   */
  hostsProjectTree?: boolean
  items: NavItem[]
}

/**
 * The navigation model — one list, two surfaces (the rail and the ⌘K palette).
 *
 * WHY ONE LIST
 * ------------
 * These were written out separately and drifted exactly the way two
 * hand-maintained lists always do. The palette went on offering "Engine · Shell"
 * and "Engine · Tasks / Containers" long after the rail had renamed them to
 * Terminal and Containers; it never listed Cluster or Analytics at all; it
 * filed the mesh configuration page under a name the rail no longer used; and
 * it advertised Users, Providers and System to every signed-in visitor, while
 * the rail showed them only to admins. Someone searching for "Terminal" got
 * nothing, because the word only existed in one of the two lists. A single list
 * cannot disagree with itself.
 *
 * NAMING RULE for `title`: name the THING the entry opens, in the operator's
 * vocabulary — not the section it sits in, and never the word "Overview".
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'platform',
    label: 'Platform',
    icon: LayoutDashboard,
    items: [
      {
        title: 'Command center',
        url: AuthDashboard(),
        icon: LayoutDashboard,
        // Without `exact`, `/dashboard` would read as active on every route.
        exact: true,
        hint: 'Platform overview',
        shortcut: 'g o',
        keywords: 'home overview dashboard start landing',
      },
      {
        title: 'Nodes',
        url: AuthDashboardNodes(),
        icon: Network,
        hint: 'Machine inventory, allocation & topology',
        shortcut: 'g n',
        keywords: 'nodes fleet servers machines mesh topology allocation',
      },
      {
        title: 'Cluster',
        url: AuthDashboardCluster(),
        icon: Server,
        hint: 'Swarm state, managers & control plane',
        keywords: 'cluster swarm manager quorum control plane master',
      },
    ],
  },
  {
    // One group for every networking plane, so they read as one system: how
    // clients reach the stack (ingress & edge), how nodes reach each other (mesh),
    // where names point (DNS), and the domains deployments publish on top.
    id: 'network',
    label: 'Network',
    icon: Network,
    items: [
      {
        title: 'Network',
        url: AuthDashboardNetwork(),
        icon: Network,
        exact: true,
        hint: 'Lanes, edge, mesh & DNS at a glance',
        keywords: 'network overview reachability exposure join',
      },
      {
        title: 'Ingress & edge',
        url: AuthDashboardNetworkIngress(),
        icon: RouteIcon,
        hint: 'Lanes & the public edge provider',
        keywords: 'ingress edge traefik tunnel cloudflare direct lanes public private local doors ports',
      },
      {
        title: 'Mesh',
        url: AuthDashboardNetworkMesh(),
        icon: Waypoints,
        hint: 'WireGuard members & links',
        keywords: 'mesh wireguard members peers links handshake join admit revoke',
      },
      {
        title: 'DNS',
        url: AuthDashboardNetworkDns(),
        icon: Network,
        hint: 'Records the lanes need',
        keywords: 'dns records cname wildcard zone',
      },
      {
        title: 'Domains',
        url: AuthDashboardNetworkDomains(),
        icon: Globe,
        hint: 'Custom domains & TLS',
        keywords: 'domains dns verify tls certificates hostnames',
      },
    ],
  },
  {
    id: 'workloads',
    label: 'Workloads',
    icon: Rocket,
    hostsProjectTree: true,
    items: [
      {
        title: 'Projects',
        url: AuthDashboardProjects(),
        icon: FolderKanban,
        hint: 'All projects',
        shortcut: 'g p',
        keywords: 'folders infrastructure apps workspaces',
      },
      {
        title: 'Services',
        url: AuthDashboardServices(),
        icon: ServerCog,
        hint: 'Service inventory',
        shortcut: 'g s',
        keywords: 'runners instances health services',
      },
      {
        title: 'Deployments',
        url: AuthDashboardDeployments(),
        icon: Rocket,
        hint: 'Timeline & rollouts',
        shortcut: 'g d',
        keywords: 'rollout release timeline deploys',
      },
    ],
  },
  {
    id: 'observability',
    label: 'Observability',
    icon: Activity,
    items: [
      {
        title: 'Analytics',
        url: DashboardAnalytics(),
        icon: Activity,
        hint: 'Mesh-wide telemetry',
        keywords: 'analytics metrics usage telemetry charts reports',
      },
    ],
  },
  {
    id: 'engine',
    label: 'Node engine',
    icon: Boxes,
    items: [
      {
        title: 'Engine',
        url: AuthDashboardDocker(),
        icon: Boxes,
        // The entries below are siblings under this path, not children of it.
        exact: true,
        hint: 'Resources of the connected node',
        shortcut: 'g c',
        keywords: 'engine node runtime resources docker daemon',
      },
      {
        title: 'Containers',
        url: AuthDashboardDockerContainers(),
        icon: Container,
        keywords: 'container task runtime service processes',
      },
      {
        title: 'Images',
        url: AuthDashboardDockerImages(),
        icon: ImageIcon,
        keywords: 'images registry builds layers scan',
      },
      {
        title: 'Networks',
        url: AuthDashboardDockerNetworks(),
        icon: Network,
        keywords: 'networks bridge overlay',
      },
      {
        title: 'Volumes',
        url: AuthDashboardDockerVolumes(),
        icon: HardDrive,
        keywords: 'volumes storage mounts',
      },
      {
        title: 'Logs',
        url: AuthDashboardDockerLogs(),
        icon: ScrollText,
        keywords: 'logs streaming output tail',
      },
      {
        title: 'Terminal',
        url: AuthDashboardDockerShell(),
        icon: TerminalSquare,
        keywords: 'terminal shell exec command console',
      },
      {
        title: 'Events',
        url: AuthDashboardDockerActivity(),
        icon: Activity,
        keywords: 'events activity stream audit feed',
      },
    ],
  },
  {
    // ONE home for settings, ordered from personal to platform-wide. Settings that
    // belong to a thing live WITH that thing — network lanes under Network, swarm
    // participation under Cluster, capacity under Nodes, project/service config on
    // their own pages — and the hub (`Overview`) says so and links there.
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      {
        title: 'Settings',
        url: AuthDashboardSettings(),
        icon: Settings,
        exact: true,
        hint: 'Where every setting lives',
        shortcut: 'g a',
        keywords: 'settings preferences configuration admin hub overview',
      },
      {
        title: 'Account',
        url: AuthDashboardSettingsAccount(),
        icon: UserCircle,
        hint: 'Your profile, password & appearance',
        shortcut: 'g u',
        keywords: 'account profile user password avatar theme dark light appearance',
      },
      {
        title: 'Users & access',
        url: AuthDashboardSettingsUsers(),
        icon: Users,
        adminOnly: true,
        hint: 'Platform users & roles',
        keywords: 'users accounts roles permissions ban invite access admin',
      },
      {
        title: 'Integrations',
        url: AuthDashboardAdminProviders(),
        icon: GitFork,
        adminOnly: true,
        hint: 'Git hosts, registries & DNS providers',
        keywords: 'integrations providers code dns cloudflare github gitlab route53 docker hub tokens',
        items: [
          { title: 'Code providers', url: AuthDashboardAdminProvidersCode() },
          { title: 'GitHub', url: AuthDashboardAdminProvidersCodeGithub() },
          { title: 'GitLab', url: AuthDashboardAdminProvidersCodeGitlab() },
          { title: 'Docker Hub', url: AuthDashboardAdminProvidersCodeDockerHub() },
          { title: 'DNS providers', url: AuthDashboardAdminProvidersDns() },
          { title: 'Cloudflare', url: AuthDashboardAdminProvidersDnsCloudflare() },
          { title: 'Route53', url: AuthDashboardAdminProvidersDnsRoute53() },
          { title: 'Google Cloud DNS', url: AuthDashboardAdminProvidersDnsGoogleDns() },
        ],
      },
      {
        title: 'This node',
        url: AuthDashboardSettingsNode(),
        icon: Server,
        adminOnly: true,
        hint: 'Configuration, address & database of this node',
        keywords: 'node configuration database url secret restart address public',
      },
      {
        title: 'Security',
        url: AuthDashboardSettingsSecurity(),
        icon: ShieldCheck,
        adminOnly: true,
        hint: 'Mesh trust keyring & strict mode',
        keywords: 'security trust keyring strict mode keys rotate mesh',
      },
    ],
  },
]

/**
 * The groups a session may see, with admin-only entries filtered out and groups
 * left empty dropped. ONE filter for the rail and the palette, so a page hidden
 * from one is never offered by the other.
 */
export function visibleNavGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.filter((group) => group.adminOnly !== true || isAdmin)
    .map((group) => ({ ...group, items: group.items.filter((item) => item.adminOnly !== true || isAdmin) }))
    .filter((group) => group.items.length > 0)
}

/** An entry owns every path beneath it unless it is marked `exact`. */
export function isNavItemActive(
  item: Pick<NavItem, 'url' | 'exact'>,
  pathname: string,
): boolean {
  if (item.exact === true) return pathname === item.url
  return pathname === item.url || pathname.startsWith(`${item.url}/`)
}

/** True when any entry nested inside `item` is the current path. */
export function hasActiveNavChild(item: NavItem, pathname: string): boolean {
  return item.items?.some((subItem) => isNavItemActive(subItem, pathname)) ?? false
}
