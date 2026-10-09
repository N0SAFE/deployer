'use client'

import { usePathname } from 'next/navigation'
import {
  AuthDashboardDockerActivity,
  AuthDashboardDockerContainers,
  AuthDashboardDockerImages,
  AuthDashboardDockerLogs,
  AuthDashboardDockerNetworks,
  AuthDashboardDockerShell,
  AuthDashboardDockerVolumes,
} from '@/routes'
import { DockerPageHeader } from './docker-page-header'

interface HeaderCopy { href: string; title: string; description: string }

// Most specific first; the overview is matched exactly.
const HEADERS: readonly HeaderCopy[] = [
  { href: AuthDashboardDockerContainers(), title: 'Containers', description: 'Every container on this node\'s Docker engine, running or stopped. Start, stop, inspect and open a shell. Application deployments live in Projects, swarm services in Cluster.' },
  { href: AuthDashboardDockerLogs(), title: 'Container logs', description: 'Live and recent output of containers on this node. Follow a stream, search it, and download what you see.' },
  { href: AuthDashboardDockerImages(), title: 'Images', description: 'Images stored on this node\'s engine. Removing an image frees disk space but containers using it keep running until recreated.' },
  { href: AuthDashboardDockerNetworks(), title: 'Networks', description: 'Docker networks on this node and the containers attached to them. Mesh (WireGuard) networking is under Network.' },
  { href: AuthDashboardDockerVolumes(), title: 'Volumes', description: 'Persistent volumes on this node. Removing a volume permanently deletes the data it holds.' },
  { href: AuthDashboardDockerActivity(), title: 'Engine activity', description: 'Live feed of what the Docker engine on this node is doing: containers starting, dying, images pulled, networks created.' },
  { href: AuthDashboardDockerShell(), title: 'Container shell', description: 'An interactive shell inside a container on this node. Commands run with that container\'s privileges.' },
]

const OVERVIEW: Omit<HeaderCopy, 'href'> = {
  title: 'Docker engine',
  description: 'Containers, images, networks and volumes on this node\'s Docker engine. This is the engine-level view: swarm services are in Cluster and application deployments are in Projects.',
}

export function DockerSectionHeader() {
  const pathname = usePathname()
  const match = HEADERS.find((h) => pathname === h.href || pathname.startsWith(`${h.href}/`))
  const copy = match ?? OVERVIEW
  return <DockerPageHeader title={copy.title} description={copy.description} />
}
