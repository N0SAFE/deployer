// Main Dashboard Components
export { default as ProjectDashboard } from './dashboard/ProjectDashboard'
export { default as ProjectDetailPage } from './project/ProjectDetailPage'

// Activity Components  
export { default as ActivityFeed } from './activity/ActivityFeed'

// Service Components
export { default as ServiceCard } from './services/ServiceCard'
export { default as ServiceForm } from './service-management/ServiceForm'

// Deployment Components
export { default as DeploymentCard } from './deployments/DeploymentCard'
export { default as DeploymentSourceForm } from './deployment-config/DeploymentSourceForm'

// Team Management Components
export { default as TeamManagement } from './team-management/TeamManagement'

// Re-export types from stores for external use
export type { Service, ServiceDependency } from '@/state/serviceStore'
export type { Deployment, DeploymentLog } from '@/state/deploymentStore'
export type { Project } from '@/hooks/useProjects'