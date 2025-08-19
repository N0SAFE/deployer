import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export interface Project {
  id: string
  name: string
  description: string | null
  repository?: string | null
  createdAt: Date
  updatedAt: Date
  ownerId?: string | null
  servicesCount?: number
  lastDeploymentAt?: Date | null
  status?: 'active' | 'inactive' | 'archived'
}

export interface ProjectCollaborator {
  id: string
  projectId: string
  userId: string
  role: 'owner' | 'admin' | 'developer' | 'viewer'
  addedAt: Date
}

interface ProjectState {
  // Data
  projects: Project[]
  selectedProject: Project | null
  collaborators: Record<string, ProjectCollaborator[]>
  
  // UI State
  isLoading: boolean
  isCreating: boolean
  error: string | null
  
  // Actions
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  deleteProject: (id: string) => void
  selectProject: (project: Project | null) => void
  
  // Collaborator actions
  setCollaborators: (projectId: string, collaborators: ProjectCollaborator[]) => void
  addCollaborator: (projectId: string, collaborator: ProjectCollaborator) => void
  updateCollaborator: (projectId: string, collaboratorId: string, updates: Partial<ProjectCollaborator>) => void
  removeCollaborator: (projectId: string, collaboratorId: string) => void
  
  // UI actions
  setLoading: (loading: boolean) => void
  setCreating: (creating: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        // Initial state
        projects: [],
        selectedProject: null,
        collaborators: {},
        isLoading: false,
        isCreating: false,
        error: null,

        // Data actions
        setProjects: (projects) => {
          set((state) => {
            state.projects = projects
            state.isLoading = false
          })
        },

        addProject: (project) => {
          set((state) => {
            state.projects.unshift(project)
            state.isCreating = false
          })
        },

        updateProject: (id, updates) => {
          set((state) => {
            const index = state.projects.findIndex((p: Project) => p.id === id)
            if (index !== -1) {
              Object.assign(state.projects[index], updates)
            }
            if (state.selectedProject?.id === id) {
              Object.assign(state.selectedProject, updates)
            }
          })
        },

        deleteProject: (id) => {
          set((state) => {
            state.projects = state.projects.filter((p: Project) => p.id !== id)
            if (state.selectedProject?.id === id) {
              state.selectedProject = null
            }
            delete state.collaborators[id]
          })
        },

        selectProject: (project) => {
          set((state) => {
            state.selectedProject = project
          })
        },

        // Collaborator actions
        setCollaborators: (projectId, collaborators) => {
          set((state) => {
            state.collaborators[projectId] = collaborators
          })
        },

        addCollaborator: (projectId, collaborator) => {
          set((state) => {
            if (!state.collaborators[projectId]) {
              state.collaborators[projectId] = []
            }
            state.collaborators[projectId].push(collaborator)
          })
        },

        updateCollaborator: (projectId, collaboratorId, updates) => {
          set((state) => {
            const collaborators = state.collaborators[projectId]
            if (collaborators) {
              const index = collaborators.findIndex((c: ProjectCollaborator) => c.id === collaboratorId)
              if (index !== -1) {
                Object.assign(collaborators[index], updates)
              }
            }
          })
        },

        removeCollaborator: (projectId, collaboratorId) => {
          set((state) => {
            const collaborators = state.collaborators[projectId]
            if (collaborators) {
              state.collaborators[projectId] = collaborators.filter((c: ProjectCollaborator) => c.id !== collaboratorId)
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

        setError: (error) => {
          set((state) => {
            state.error = error
            state.isLoading = false
            state.isCreating = false
          })
        },

        clearError: () => {
          set((state) => {
            state.error = null
          })
        },
      }))
    ),
    {
      name: 'project-store',
    }
  )
)

// Selectors
export const useSelectedProject = () => useProjectStore(state => state.selectedProject)
export const useProjectsLoading = () => useProjectStore(state => state.isLoading)
export const useProjectError = () => useProjectStore(state => state.error)