'use client'

import React, { createContext, useContext, useReducer, ReactNode } from 'react'

// Types
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
  
  // Global loading states
  globalLoading: boolean
}

type UIAction =
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; collapsed: boolean }
  | { type: 'TOGGLE_MOBILE_MENU' }
  | { type: 'SET_MOBILE_MENU_OPEN'; open: boolean }
  | { type: 'OPEN_MODAL'; modal: Omit<Modal, 'id'> }
  | { type: 'CLOSE_MODAL'; id: string }
  | { type: 'CLOSE_ALL_MODALS' }
  | { type: 'SET_GLOBAL_LOADING'; loading: boolean }

// Initial state
const initialState: UIState = {
  sidebarCollapsed: false,
  mobileMenuOpen: false,
  modals: [],
  globalLoading: false,
}

// Reducer
let modalIdCounter = 0

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return {
        ...state,
        sidebarCollapsed: !state.sidebarCollapsed,
      }

    case 'SET_SIDEBAR_COLLAPSED':
      return {
        ...state,
        sidebarCollapsed: action.collapsed,
      }

    case 'TOGGLE_MOBILE_MENU':
      return {
        ...state,
        mobileMenuOpen: !state.mobileMenuOpen,
      }

    case 'SET_MOBILE_MENU_OPEN':
      return {
        ...state,
        mobileMenuOpen: action.open,
      }

    case 'OPEN_MODAL':
      const newModal: Modal = {
        ...action.modal,
        id: `modal-${modalIdCounter++}`,
      }
      return {
        ...state,
        modals: [...state.modals, newModal],
      }

    case 'CLOSE_MODAL':
      return {
        ...state,
        modals: state.modals.filter((modal) => modal.id !== action.id),
      }

    case 'CLOSE_ALL_MODALS':
      return {
        ...state,
        modals: [],
      }

    case 'SET_GLOBAL_LOADING':
      return {
        ...state,
        globalLoading: action.loading,
      }

    default:
      return state
  }
}

// Context
interface UIContextType {
  state: UIState
  // Navigation actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleMobileMenu: () => void
  setMobileMenuOpen: (open: boolean) => void
  
  // Modal actions
  openModal: (modal: Omit<Modal, 'id'>) => void
  closeModal: (id: string) => void
  closeAllModals: () => void
  
  // Global loading
  setGlobalLoading: (loading: boolean) => void
}

const UIContext = createContext<UIContextType | undefined>(undefined)

// Provider
interface UIProviderProps {
  children: ReactNode
}

export function UIProvider({ children }: UIProviderProps) {
  const [state, dispatch] = useReducer(uiReducer, initialState)

  const contextValue: UIContextType = {
    state,
    // Navigation actions
    toggleSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),
    setSidebarCollapsed: (collapsed: boolean) => 
      dispatch({ type: 'SET_SIDEBAR_COLLAPSED', collapsed }),
    toggleMobileMenu: () => dispatch({ type: 'TOGGLE_MOBILE_MENU' }),
    setMobileMenuOpen: (open: boolean) => 
      dispatch({ type: 'SET_MOBILE_MENU_OPEN', open }),
    
    // Modal actions
    openModal: (modal: Omit<Modal, 'id'>) => 
      dispatch({ type: 'OPEN_MODAL', modal }),
    closeModal: (id: string) => 
      dispatch({ type: 'CLOSE_MODAL', id }),
    closeAllModals: () => 
      dispatch({ type: 'CLOSE_ALL_MODALS' }),
    
    // Global loading
    setGlobalLoading: (loading: boolean) => 
      dispatch({ type: 'SET_GLOBAL_LOADING', loading }),
  }

  return (
    <UIContext.Provider value={contextValue}>
      {children}
    </UIContext.Provider>
  )
}

// Hook
export function useUI() {
  const context = useContext(UIContext)
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider')
  }
  return context
}

// Convenience hooks
export function useSidebarCollapsed() {
  const { state } = useUI()
  return state.sidebarCollapsed
}

export function useMobileMenuOpen() {
  const { state } = useUI()
  return state.mobileMenuOpen
}

export function useModals() {
  const { state } = useUI()
  return state.modals
}

export function useGlobalLoading() {
  const { state } = useUI()
  return state.globalLoading
}