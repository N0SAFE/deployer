import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export interface Service {
  id: string
  name: string
  description: string | null
  projectId: string
  dockerfilePath: string | null
  buildArgs: Record<string, string> | null
  envVars: Record<string, string> | null
  subdomain: string | null
  customDomain: string | null
  port: number
  healthCheckPath: string | null
  cpuLimit: string | null
  memoryLimit: string | null
  isEnabled: boolean
  createdAt: Date
  updatedAt: Date
  status?: 'running' | 'stopped' | 'deploying' | 'error' | 'starting'
  currentDeploymentId?: string | null
  lastDeploymentAt?: Date | null
}

export interface ServiceDependency {
  id: string
  serviceId: string
  dependsOnId: string
  createdAt: Date
}

interface ServiceState {
  // Data
  services: Record<string, Service[]> // projectId -> services[]
  selectedService: Service | null
  dependencies: Record<string, ServiceDependency[]> // serviceId -> dependencies[]
  
  // UI State
  isLoading: boolean
  isCreating: boolean
  isUpdating: boolean
  error: string | null
  
  // Actions
  setServices: (projectId: string, services: Service[]) => void
  addService: (service: Service) => void
  updateService: (id: string, updates: Partial<Service>) => void
  deleteService: (id: string, projectId: string) => void
  selectService: (service: Service | null) => void
  
  // Service status actions
  updateServiceStatus: (id: string, status: Service['status']) => void
  updateServiceDeployment: (id: string, deploymentId: string | null, deployedAt?: Date) => void
  
  // Dependency actions
  setDependencies: (serviceId: string, dependencies: ServiceDependency[]) => void
  addDependency: (dependency: ServiceDependency) => void
  removeDependency: (serviceId: string, dependencyId: string) => void
  
  // UI actions
  setLoading: (loading: boolean) => void
  setCreating: (creating: boolean) => void
  setUpdating: (updating: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
  
  // Helpers
  getServicesByProject: (projectId: string) => Service[]
  getServiceById: (serviceId: string) => Service | undefined
}

export const useServiceStore = create<ServiceState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        services: {},
        selectedService: null,
        dependencies: {},
        isLoading: false,
        isCreating: false,
        isUpdating: false,
        error: null,

        // Data actions
        setServices: (projectId, services) => {
          set((state) => {
            state.services[projectId] = services
            state.isLoading = false
          })
        },

        addService: (service) => {
          set((state) => {
            if (!state.services[service.projectId]) {
              state.services[service.projectId] = []
            }
            state.services[service.projectId].unshift(service)
            state.isCreating = false
          })
        },

        updateService: (id, updates) => {
          set((state) => {
            // Find and update service in all projects
            for (const projectId in state.services) {
              const serviceIndex = state.services[projectId].findIndex((s: Service) => s.id === id)
              if (serviceIndex !== -1) {
                Object.assign(state.services[projectId][serviceIndex], updates)
                
                // Update selected service if it's the same
                if (state.selectedService?.id === id) {
                  Object.assign(state.selectedService, updates)
                }
                break
              }
            }
          })
        },

        deleteService: (id, projectId) => {
          set((state) => {
            if (state.services[projectId]) {
              state.services[projectId] = state.services[projectId].filter((s: Service) => s.id !== id)
            }
            if (state.selectedService?.id === id) {
              state.selectedService = null
            }
            delete state.dependencies[id]
          })
        },

        selectService: (service) => {
          set((state) => {
            state.selectedService = service
          })
        },

        // Service status actions
        updateServiceStatus: (id, status) => {
          get().updateService(id, { status })
        },

        updateServiceDeployment: (id, deploymentId, deployedAt) => {
          const updates: Partial<Service> = {
            currentDeploymentId: deploymentId,
          }
          if (deployedAt) {
            updates.lastDeploymentAt = deployedAt
          }
          get().updateService(id, updates)
        },

        // Dependency actions
        setDependencies: (serviceId, dependencies) => {
          set((state) => {
            state.dependencies[serviceId] = dependencies
          })
        },

        addDependency: (dependency) => {
          set((state) => {
            if (!state.dependencies[dependency.serviceId]) {
              state.dependencies[dependency.serviceId] = []
            }
            state.dependencies[dependency.serviceId].push(dependency)
          })
        },

        removeDependency: (serviceId, dependencyId) => {
          set((state) => {
            const dependencies = state.dependencies[serviceId]
            if (dependencies) {
              state.dependencies[serviceId] = dependencies.filter((d: ServiceDependency) => d.id !== dependencyId)
            }
          })
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

        setCreating: (creating) => {
          set((state) => {
            state.isCreating = creating
            if (creating) {
              state.error = null
            }
          })
        },

        setUpdating: (updating) => {
          set((state) => {
            state.isUpdating = updating
            if (updating) {
              state.error = null
            }
          })
        },

        setError: (error) => {
          set((state) => {
            state.error = error
            state.isLoading = false
            state.isCreating = false
            state.isUpdating = false
          })
        },

        clearError: () => {
          set((state) => {
            state.error = null
          })
        },

        // Helpers
        getServicesByProject: (projectId) => {
          return get().services[projectId] || []
        },

        getServiceById: (serviceId) => {
          const state = get()
          for (const projectServices of Object.values(state.services)) {
            const service = projectServices.find((s: Service) => s.id === serviceId)
            if (service) return service
          }
          return undefined
        },
      }))
    ),
    {
      name: 'service-store',
    }
  )
)

// Selectors
export const useSelectedService = () => useServiceStore(state => state.selectedService)
export const useServicesLoading = () => useServiceStore(state => state.isLoading)
export const useServiceError = () => useServiceStore(state => state.error)
export const useServicesByProject = (projectId: string) => 
  useServiceStore(state => state.getServicesByProject(projectId))