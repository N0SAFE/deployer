import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export interface Deployment {
  id: string
  serviceId: string
  environment: 'production' | 'preview' | 'development'
  status: 'pending' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
  sourceType: 'git' | 'upload'
  sourceConfig: Record<string, string | number | boolean>
  buildLogs: string | null
  deploymentLogs: string | null
  imageTag: string | null
  containerId: string | null
  traefikRuleId: string | null
  url: string | null
  triggeredById: string | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
  duration?: number
  progress?: number
}

export interface DeploymentLog {
  id: string
  deploymentId: string
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: 'build' | 'deploy' | 'runtime'
}

interface DeploymentState {
  // Data
  deployments: Record<string, Deployment[]> // serviceId -> deployments[]
  globalDeployments: Deployment[]
  selectedDeployment: Deployment | null
  deploymentLogs: Record<string, DeploymentLog[]> // deploymentId -> logs[]
  
  // Real-time state
  activeDeployments: Set<string> // deployment IDs currently in progress
  logStreams: Set<string> // deployment IDs with active log streaming
  
  // UI State
  isLoading: boolean
  error: string | null
  
  // Actions
  setDeployments: (serviceId: string, deployments: Deployment[]) => void
  setGlobalDeployments: (deployments: Deployment[]) => void
  addDeployment: (deployment: Deployment) => void
  updateDeployment: (id: string, updates: Partial<Deployment>) => void
  selectDeployment: (deployment: Deployment | null) => void
  
  // Real-time deployment updates
  updateDeploymentStatus: (id: string, status: Deployment['status'], progress?: number) => void
  updateDeploymentProgress: (id: string, progress: number) => void
  completeDeployment: (id: string, status: 'success' | 'failed', completedAt?: Date) => void
  
  // Log management
  setDeploymentLogs: (deploymentId: string, logs: DeploymentLog[]) => void
  addDeploymentLog: (deploymentId: string, log: DeploymentLog) => void
  clearDeploymentLogs: (deploymentId: string) => void
  
  // Stream management
  startLogStream: (deploymentId: string) => void
  stopLogStream: (deploymentId: string) => void
  addActiveDeployment: (deploymentId: string) => void
  removeActiveDeployment: (deploymentId: string) => void
  
  // Actions
  triggerDeployment: (serviceId: string, environment: string, sourceConfig: any) => void
  cancelDeployment: (deploymentId: string) => void
  rollbackDeployment: (deploymentId: string) => void
  
  // UI actions
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
  
  // Helpers
  getDeploymentsByService: (serviceId: string) => Deployment[]
  getActiveDeployments: () => Deployment[]
  getLatestDeployment: (serviceId: string) => Deployment | undefined
}

export const useDeploymentStore = create<DeploymentState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        deployments: {},
        globalDeployments: [],
        selectedDeployment: null,
        deploymentLogs: {},
        activeDeployments: new Set(),
        logStreams: new Set(),
        isLoading: false,
        error: null,

        // Data actions
        setDeployments: (serviceId, deployments) => {
          set((state) => {
            state.deployments[serviceId] = deployments
            state.isLoading = false
          })
        },

        setGlobalDeployments: (deployments) => {
          set((state) => {
            state.globalDeployments = deployments
            state.isLoading = false
          })
        },

        addDeployment: (deployment) => {
          set((state) => {
            // Add to service-specific deployments
            if (!state.deployments[deployment.serviceId]) {
              state.deployments[deployment.serviceId] = []
            }
            state.deployments[deployment.serviceId].unshift(deployment)
            
            // Add to global deployments
            state.globalDeployments.unshift(deployment)
            
            // Add to active if in progress
            if (['pending', 'building', 'deploying'].includes(deployment.status)) {
              state.activeDeployments.add(deployment.id)
            }
          })
        },

        updateDeployment: (id, updates) => {
          set((state) => {
            // Update in service-specific deployments
            for (const serviceDeployments of Object.values(state.deployments)) {
              const deploymentIndex = serviceDeployments.findIndex((d: Deployment) => d.id === id)
              if (deploymentIndex !== -1) {
                Object.assign(serviceDeployments[deploymentIndex], updates)
                break
              }
            }
            
            // Update in global deployments
            const globalIndex = state.globalDeployments.findIndex((d: Deployment) => d.id === id)
            if (globalIndex !== -1) {
              Object.assign(state.globalDeployments[globalIndex], updates)
            }
            
            // Update selected deployment
            if (state.selectedDeployment?.id === id) {
              Object.assign(state.selectedDeployment, updates)
            }
          })
        },

        selectDeployment: (deployment) => {
          set((state) => {
            state.selectedDeployment = deployment
          })
        },

        // Real-time deployment updates
        updateDeploymentStatus: (id, status, progress) => {
          const updates: Partial<Deployment> = { status }
          if (progress !== undefined) {
            updates.progress = progress
          }
          if (status === 'building' && !get().getDeploymentsByService('').find((d: Deployment) => d.id === id)?.startedAt) {
            updates.startedAt = new Date()
          }
          get().updateDeployment(id, updates)
          
          // Manage active deployments
          if (['pending', 'building', 'deploying'].includes(status)) {
            get().addActiveDeployment(id)
          } else {
            get().removeActiveDeployment(id)
          }
        },

        updateDeploymentProgress: (id, progress) => {
          get().updateDeployment(id, { progress })
        },

        completeDeployment: (id, status, completedAt = new Date()) => {
          const deployment = get().globalDeployments.find((d: Deployment) => d.id === id)
          const duration = deployment?.startedAt 
            ? completedAt.getTime() - deployment.startedAt.getTime()
            : undefined
            
          get().updateDeployment(id, { 
            status, 
            completedAt, 
            progress: 100,
            duration
          })
          get().removeActiveDeployment(id)
        },

        // Log management
        setDeploymentLogs: (deploymentId, logs) => {
          set((state) => {
            state.deploymentLogs[deploymentId] = logs
          })
        },

        addDeploymentLog: (deploymentId, log) => {
          set((state) => {
            if (!state.deploymentLogs[deploymentId]) {
              state.deploymentLogs[deploymentId] = []
            }
            state.deploymentLogs[deploymentId].push(log)
          })
        },

        clearDeploymentLogs: (deploymentId) => {
          set((state) => {
            delete state.deploymentLogs[deploymentId]
          })
        },

        // Stream management
        startLogStream: (deploymentId) => {
          set((state) => {
            state.logStreams.add(deploymentId)
          })
        },

        stopLogStream: (deploymentId) => {
          set((state) => {
            state.logStreams.delete(deploymentId)
          })
        },

        addActiveDeployment: (deploymentId) => {
          set((state) => {
            state.activeDeployments.add(deploymentId)
          })
        },

        removeActiveDeployment: (deploymentId) => {
          set((state) => {
            state.activeDeployments.delete(deploymentId)
            state.logStreams.delete(deploymentId)
          })
        },

        // Actions (these will integrate with ORPC later)
        triggerDeployment: (serviceId, environment, sourceConfig) => {
          // This will be implemented with ORPC integration
          console.log('Triggering deployment:', { serviceId, environment, sourceConfig })
        },

        cancelDeployment: (deploymentId) => {
          // This will be implemented with ORPC integration
          console.log('Cancelling deployment:', deploymentId)
          get().updateDeploymentStatus(deploymentId, 'cancelled')
        },

        rollbackDeployment: (deploymentId) => {
          // This will be implemented with ORPC integration
          console.log('Rolling back deployment:', deploymentId)
        },

        // UI actions
        setLoading: (loading) => {
          set((state) => {
            state.isLoading = loading
            if (loading) {
              state.error = null
            }
          })
        },

        setError: (error) => {
          set((state) => {
            state.error = error
            state.isLoading = false
          })
        },

        clearError: () => {
          set((state) => {
            state.error = null
          })
        },

        // Helpers
        getDeploymentsByService: (serviceId) => {
          return get().deployments[serviceId] || []
        },

        getActiveDeployments: () => {
          const state = get()
          return state.globalDeployments.filter((d: Deployment) => 
            state.activeDeployments.has(d.id)
          )
        },

        getLatestDeployment: (serviceId) => {
          const deployments = get().getDeploymentsByService(serviceId)
          return deployments[0] // Assuming they're sorted by creation date descending
        },
      }))
    ),
    {
      name: 'deployment-store',
    }
  )
)

// Selectors
export const useSelectedDeployment = () => useDeploymentStore(state => state.selectedDeployment)
export const useDeploymentsLoading = () => useDeploymentStore(state => state.isLoading)
export const useDeploymentError = () => useDeploymentStore(state => state.error)
export const useActiveDeployments = () => useDeploymentStore(state => state.getActiveDeployments())
export const useDeploymentsByService = (serviceId: string) => 
  useDeploymentStore(state => state.getDeploymentsByService(serviceId))