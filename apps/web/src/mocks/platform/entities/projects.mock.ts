import type { MockProject } from '../types'

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: 'proj-orion-control-plane',
    organizationId: 'org-affluences',
    teamId: 'team-platform-core',
    slug: 'orion-control-plane',
    name: 'Orion Commerce Mesh',
    description: 'Complex control plane with layered services, orchestration, and data backplanes.',
  },
  {
    id: 'proj-phoenix-stream',
    organizationId: 'org-affluences',
    teamId: 'team-commerce',
    slug: 'phoenix-stream',
    name: 'Phoenix Media Pipeline',
    description: 'Low-latency ingestion and transcoding workflows with adaptive fanout.',
  },
  {
    id: 'proj-atlas-billing',
    organizationId: 'org-northwind',
    teamId: 'team-finops',
    slug: 'atlas-billing',
    name: 'Atlas Billing Engine',
    description: 'Subscription billing with retries, dunning, and ledger synchronization.',
  },
  {
    id: 'proj-nebula-mlops',
    organizationId: 'org-labs',
    teamId: 'team-mlops',
    slug: 'nebula-mlops',
    name: 'Nebula MLOps Runtime',
    description: 'Experiment tracking, feature generation, and online model serving.',
  },
]