import type { MockOrganization } from '../types'

export const MOCK_ORGANIZATIONS: MockOrganization[] = [
  {
    id: 'org-affluences',
    slug: 'affluences',
    name: 'Affluences Platform',
    plan: 'enterprise',
    region: 'eu-west-1',
  },
  {
    id: 'org-northwind',
    slug: 'northwind',
    name: 'Northwind Retail Group',
    plan: 'team',
    region: 'us-east-1',
  },
  {
    id: 'org-labs',
    slug: 'labs',
    name: 'Applied Research Labs',
    plan: 'free',
    region: 'eu-central-1',
  },
]