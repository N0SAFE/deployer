import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  timestamp: Date
}

export interface Modal {
  id: string
  component: string
  props: Record<string, unknown>
}

interface UIState {
  // Navigation
  sidebarCollapsed: boolean
  mobileMenuOpen: boolean
  
  // Modals and dialogs
  modals: Modal[]
  
  // Notifications/Toasts
  notifications: Notification[]
  
  // Global loading states
  globalLoading: boolean
  
  // Theme
  theme: 'light' | 'dark' | 'system'
  
  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleMobileMenu: () => void
  setMobileMenuOpen: (open: boolean) => void
  
  // Modal actions
  openModal: (modal: Omit<Modal, 'id'>) => void
  closeModal: (id: string) => void
  closeAllModals: () => void
  
  // Notification actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
  
  // Global loading
  setGlobalLoading: (loading: boolean) => void
  
  // Theme actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

let notificationIdCounter = 0
let modalIdCounter = 0

export const useUIStore = create<UIState>()(
  devtools(
    (set, get) => ({
      // Initial state
      sidebarCollapsed: false,
      mobileMenuOpen: false,
      modals: [],
      notifications: [],
      globalLoading: false,
      theme: 'system',

      // Navigation actions
      toggleSidebar: () => {
        set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed,
        }))
      },

      setSidebarCollapsed: (collapsed) => {
        set({ sidebarCollapsed: collapsed })
      },

      toggleMobileMenu: () => {
        set((state) => ({
          mobileMenuOpen: !state.mobileMenuOpen,
        }))
      },

      setMobileMenuOpen: (open) => {
        set({ mobileMenuOpen: open })
      },

      // Modal actions
      openModal: (modal) => {
        const newModal: Modal = {
          ...modal,
          id: `modal-${modalIdCounter++}`,
        }
        set((state) => ({
          modals: [...state.modals, newModal],
        }))
      },

      closeModal: (id) => {
        set((state) => ({
          modals: state.modals.filter((modal) => modal.id !== id),
        }))
      },

      closeAllModals: () => {
        set({ modals: [] })
      },

      // Notification actions
      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: `notification-${notificationIdCounter++}`,
          timestamp: new Date(),
          duration: notification.duration ?? (notification.type === 'error' ? 0 : 5000), // Error notifications don't auto-dismiss
        }

        set((state) => ({
          notifications: [...state.notifications, newNotification],
        }))

        // Auto-remove notification if duration is set
        if (newNotification.duration && newNotification.duration > 0) {
          setTimeout(() => {
            get().removeNotification(newNotification.id)
          }, newNotification.duration)
        }
      },

      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((notification) => notification.id !== id),
        }))
      },

      clearNotifications: () => {
        set({ notifications: [] })
      },

      // Global loading
      setGlobalLoading: (loading) => {
        set({ globalLoading: loading })
      },

      // Theme actions
      setTheme: (theme) => {
        set({ theme })
        
        // Apply theme to document
        if (typeof window !== 'undefined') {
          if (theme === 'dark') {
            document.documentElement.classList.add('dark')
          } else if (theme === 'light') {
            document.documentElement.classList.remove('dark')
          } else {
            // System preference
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
            document.documentElement.classList.toggle('dark', isDark)
          }
        }
      },
    }),
    {
      name: 'ui-store',
    }
  )
)

// Convenience hooks
export const useSidebarCollapsed = () => useUIStore((state) => state.sidebarCollapsed)
export const useMobileMenuOpen = () => useUIStore((state) => state.mobileMenuOpen)
export const useModals = () => useUIStore((state) => state.modals)
export const useNotifications = () => useUIStore((state) => state.notifications)
export const useGlobalLoading = () => useUIStore((state) => state.globalLoading)
export const useTheme = () => useUIStore((state) => state.theme)