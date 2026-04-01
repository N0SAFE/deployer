import type { MockTeam } from '../types'

export const MOCK_TEAMS: MockTeam[] = [
  {
    id: 'team-platform-core',
    organizationId: 'org-affluences',
    name: 'Platform Core',
    purpose: 'Shared runtime, deployments, and observability platform',
  },
  {
    id: 'team-commerce',
    organizationId: 'org-affluences',
    name: 'Commerce Domain',
    purpose: 'Checkout, catalog, and user journey APIs',
  },
  {
    id: 'team-finops',
    organizationId: 'org-northwind',
    name: 'FinOps',
    purpose: 'Billing, subscriptions, and reconciliation workflows',
  },
  {
    id: 'team-mlops',
    organizationId: 'org-labs',
    name: 'MLOps',
    purpose: 'Model serving, feature pipelines, and experiment orchestration',
  },
]
