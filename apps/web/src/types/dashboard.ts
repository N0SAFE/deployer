// Dashboard Types - Organizations, Teams, Services, Environments

// ============================================
// Organization Types
// ============================================

export type OrganizationPlan = 'free' | 'pro' | 'enterprise'
export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  avatar?: string
  plan: OrganizationPlan
  createdAt: Date
  updatedAt: Date
  _count: {
    members: number
    teams: number
    projects: number
  }
}

export interface OrganizationMember {
  id: string
  userId: string
  organizationId: string
  role: OrganizationRole
  user: {
    id: string
    name: string
    email: string
    avatar?: string
  }
  joinedAt: Date
}

export interface OrganizationWithMembers extends Organization {
  members: OrganizationMember[]
}

// ============================================
// Team Types
// ============================================

export type TeamRole = 'lead' | 'member'

export interface Team {
  id: string
  name: string
  slug: string
  description?: string
  organizationId: string
  organization?: Pick<Organization, 'id' | 'name' | 'slug'>
  createdAt: Date
  updatedAt: Date
  _count: {
    members: number
    projects: number
  }
}

export interface TeamMember {
  id: string
  userId: string
  teamId: string
  role: TeamRole
  user: {
    id: string
    name: string
    email: string
    avatar?: string
  }
  joinedAt: Date
}

export interface TeamWithMembers extends Team {
  members: TeamMember[]
}

// ============================================
// Service Types
// ============================================

export type ServiceType = 'web' | 'api' | 'worker' | 'database' | 'cache' | 'queue' | 'storage'
export type ServiceRuntime = 'node' | 'python' | 'go' | 'rust' | 'docker' | 'static'
export type EnvironmentStatus = 'active' | 'inactive' | 'deploying' | 'failed' | 'pending'
export type DependencyType = 'required' | 'optional'
export type ConnectionType = 'http' | 'tcp' | 'env' | 'internal' | 'grpc'

export interface ServiceDependency {
  id: string
  sourceServiceId: string
  targetServiceId: string
  type: DependencyType
  connectionType: ConnectionType
  description?: string
  targetService: {
    id: string
    name: string
    slug: string
    type: ServiceType
  }
}

export interface EnvironmentConfig {
  id: string
  name: string
  slug: string
  url?: string
  status: EnvironmentStatus
  lastDeployedAt?: Date
  version?: string
  envVarsCount: number
  resources: {
    cpu: string
    memory: string
    instances: number
  }
}

export interface Service {
  id: string
  name: string
  slug: string
  projectId: string
  project?: {
    id: string
    name: string
    slug: string
  }
  type: ServiceType
  runtime: ServiceRuntime
  repository?: string
  branch: string
  buildCommand?: string
  startCommand?: string
  healthCheckPath?: string
  port?: number
  
  // Dependencies
  dependencies: ServiceDependency[]
  dependents: ServiceDependency[]
  
  // Environment configs per environment
  environments: {
    production?: EnvironmentConfig
    staging?: EnvironmentConfig
    development?: EnvironmentConfig
  }
  
  // Stats
  _count: {
    deployments: number
    previewDeployments: number
  }
  
  createdAt: Date
  updatedAt: Date
}

export interface ServiceWithDetails extends Service {
  latestDeployment?: {
    id: string
    status: string
    createdAt: Date
    environment: string
  }
}

// ============================================
// Preview Deployment Types
// ============================================

export type PreviewDeploymentStatus = 'building' | 'deploying' | 'active' | 'inactive' | 'failed' | 'expired'

export interface PreviewDeployment {
  id: string
  deploymentId: string
  serviceId: string
  service?: Pick<Service, 'id' | 'name' | 'slug' | 'type'>
  pullRequestId?: number
  pullRequestTitle?: string
  pullRequestUrl?: string
  branchName: string
  commitSha?: string
  commitMessage?: string
  url: string
  status: PreviewDeploymentStatus
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  createdBy: {
    id: string
    name: string
    avatar?: string
  }
}

// ============================================
// Environment Types
// ============================================

export type EnvironmentType = 'production' | 'staging' | 'development' | 'preview'

export interface Environment {
  id: string
  name: string
  slug: string
  type: EnvironmentType
  projectId: string
  isProtected: boolean
  autoDeployBranch?: string
  url?: string
  createdAt: Date
  _count: {
    deployments: number
    services: number
  }
}

// ============================================
// React Flow Graph Types
// ============================================

export interface ServiceNodeData {
  id: string
  name: string
  type: ServiceType
  runtime: ServiceRuntime
  status: EnvironmentStatus
  url?: string
  healthCheckPath?: string
}

export interface DependencyEdgeData {
  type: DependencyType
  connectionType: ConnectionType
  label?: string
}
