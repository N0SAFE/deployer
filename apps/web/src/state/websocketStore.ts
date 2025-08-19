import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { io, Socket } from 'socket.io-client'
import { useDeploymentStore, type Deployment } from './deploymentStore'
import { useServiceStore, type Service } from './serviceStore'
import { useUIStore } from './uiStore'

export interface DeploymentUpdateEvent {
  deploymentId: string
  updates: Partial<Deployment>
}

export interface ServiceStatusUpdateEvent {
  serviceId: string
  status: Service['status']
}

export interface LogStreamEvent {
  deploymentId: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: 'build' | 'deploy' | 'runtime'
}

export interface WebSocketState {
  // Connection state
  socket: Socket | null
  isConnected: boolean
  isConnecting: boolean
  reconnectAttempts: number
  lastError: string | null
  
  // Subscriptions
  subscribedRooms: Set<string>
  
  // Actions
  connect: () => void
  disconnect: () => void
  reconnect: () => void
  
  // Room management
  joinRoom: (room: string) => void
  leaveRoom: (room: string) => void
  leaveAllRooms: () => void
  
  // Event handlers (these will be called by socket events)
  handleDeploymentUpdate: (data: DeploymentUpdateEvent) => void
  handleServiceStatusUpdate: (data: ServiceStatusUpdateEvent) => void
  handleLogStream: (data: LogStreamEvent) => void
  
  // Internal
  setSocket: (socket: Socket | null) => void
  setConnected: (connected: boolean) => void
  setConnecting: (connecting: boolean) => void
  setError: (error: string | null) => void
  incrementReconnectAttempts: () => void
  resetReconnectAttempts: () => void
}

export const useWebSocketStore = create<WebSocketState>()(
  devtools(
    (set, get) => ({
      // Initial state
      socket: null,
      isConnected: false,
      isConnecting: false,
      reconnectAttempts: 0,
      lastError: null,
      subscribedRooms: new Set(),

      // Connection actions
      connect: () => {
        const state = get()
        if (state.socket || state.isConnecting) return

        set({ isConnecting: true, lastError: null })

        try {
          const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005', {
            transports: ['websocket', 'polling'],
            timeout: 10000,
            reconnectionAttempts: 5,
            reconnectionDelay: 2000,
          })

          // Connection event handlers
          socket.on('connect', () => {
            console.log('WebSocket connected')
            set({ 
              isConnected: true, 
              isConnecting: false, 
              lastError: null 
            })
            get().resetReconnectAttempts()
            
            // Rejoin all previously subscribed rooms
            const rooms = get().subscribedRooms
            rooms.forEach(room => {
              socket.emit('join-room', room)
            })
          })

          socket.on('disconnect', (reason) => {
            console.log('WebSocket disconnected:', reason)
            set({ 
              isConnected: false, 
              isConnecting: false 
            })
          })

          socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error)
            set({ 
              isConnected: false, 
              isConnecting: false, 
              lastError: error.message 
            })
            get().incrementReconnectAttempts()
          })

          // Business logic event handlers
          socket.on('deployment:update', get().handleDeploymentUpdate)
          socket.on('deployment:progress', (data) => {
            useDeploymentStore.getState().updateDeploymentProgress(data.deploymentId, data.progress)
          })
          socket.on('deployment:status', (data) => {
            useDeploymentStore.getState().updateDeploymentStatus(data.deploymentId, data.status, data.progress)
          })
          socket.on('deployment:complete', (data) => {
            useDeploymentStore.getState().completeDeployment(data.deploymentId, data.status, data.completedAt)
          })
          socket.on('deployment:log', get().handleLogStream)

          socket.on('service:status', get().handleServiceStatusUpdate)

          set({ socket })
        } catch (error) {
          console.error('Failed to create WebSocket connection:', error)
          set({ 
            isConnecting: false, 
            lastError: error instanceof Error ? error.message : 'Failed to connect' 
          })
        }
      },

      disconnect: () => {
        const { socket } = get()
        if (socket) {
          socket.disconnect()
          set({ 
            socket: null, 
            isConnected: false, 
            isConnecting: false,
            subscribedRooms: new Set()
          })
        }
      },

      reconnect: () => {
        get().disconnect()
        setTimeout(() => {
          get().connect()
        }, 1000)
      },

      // Room management
      joinRoom: (room) => {
        const { socket, subscribedRooms } = get()
        if (socket?.connected) {
          socket.emit('join-room', room)
          subscribedRooms.add(room)
          set({ subscribedRooms: new Set(subscribedRooms) })
        }
      },

      leaveRoom: (room) => {
        const { socket, subscribedRooms } = get()
        if (socket?.connected) {
          socket.emit('leave-room', room)
        }
        subscribedRooms.delete(room)
        set({ subscribedRooms: new Set(subscribedRooms) })
      },

      leaveAllRooms: () => {
        const { socket, subscribedRooms } = get()
        if (socket?.connected) {
          subscribedRooms.forEach(room => {
            socket.emit('leave-room', room)
          })
        }
        set({ subscribedRooms: new Set() })
      },

      // Event handlers
      handleDeploymentUpdate: (data) => {
        const deploymentStore = useDeploymentStore.getState()
        deploymentStore.updateDeployment(data.deploymentId, data.updates)
        
        // Show notification for important status changes
        if (data.updates.status === 'success') {
          useUIStore.getState().addNotification({
            type: 'success',
            title: 'Deployment Complete',
            message: `Deployment ${data.deploymentId} completed successfully`,
          })
        } else if (data.updates.status === 'failed') {
          useUIStore.getState().addNotification({
            type: 'error',
            title: 'Deployment Failed',
            message: `Deployment ${data.deploymentId} failed`,
          })
        }
      },

      handleServiceStatusUpdate: (data) => {
        const serviceStore = useServiceStore.getState()
        serviceStore.updateServiceStatus(data.serviceId, data.status)
      },

      handleLogStream: (data) => {
        const deploymentStore = useDeploymentStore.getState()
        deploymentStore.addDeploymentLog(data.deploymentId, {
          id: `${data.deploymentId}-${Date.now()}`,
          deploymentId: data.deploymentId,
          timestamp: new Date(data.timestamp),
          level: data.level,
          message: data.message,
          source: data.source,
        })
      },

      // Internal actions
      setSocket: (socket) => set({ socket }),
      setConnected: (connected) => set({ isConnected: connected }),
      setConnecting: (connecting) => set({ isConnecting: connecting }),
      setError: (error) => set({ lastError: error }),
      
      incrementReconnectAttempts: () => {
        set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }))
      },

      resetReconnectAttempts: () => {
        set({ reconnectAttempts: 0 })
      },
    }),
    {
      name: 'websocket-store',
    }
  )
)

// Convenience hooks
export const useWebSocketConnection = () => {
  const isConnected = useWebSocketStore((state) => state.isConnected)
  const isConnecting = useWebSocketStore((state) => state.isConnecting)
  const lastError = useWebSocketStore((state) => state.lastError)
  const reconnectAttempts = useWebSocketStore((state) => state.reconnectAttempts)
  
  return { isConnected, isConnecting, lastError, reconnectAttempts }
}

export const useWebSocketActions = () => {
  const connect = useWebSocketStore((state) => state.connect)
  const disconnect = useWebSocketStore((state) => state.disconnect)
  const reconnect = useWebSocketStore((state) => state.reconnect)
  const joinRoom = useWebSocketStore((state) => state.joinRoom)
  const leaveRoom = useWebSocketStore((state) => state.leaveRoom)
  
  return { connect, disconnect, reconnect, joinRoom, leaveRoom }
}