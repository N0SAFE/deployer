'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { orpc } from '@/lib/orpc';
import { toast } from 'sonner';

// WebSocket event interfaces
export interface DeploymentUpdateEvent {
  deploymentId: string;
  status?: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled';
  progress?: number;
  stage?: string;
  message?: string;
  completedAt?: string;
}

export interface ServiceStatusUpdateEvent {
  serviceId: string;
  status: 'running' | 'stopped' | 'error' | 'building' | 'starting';
}

export interface LogStreamEvent {
  deploymentId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  service?: string;
  stage?: string;
}

// WebSocket connection state
export interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
  subscribedRooms: Set<string>;
}

// Main WebSocket hook
export function useWebSocket() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    reconnectAttempts: 0,
    lastError: null,
    subscribedRooms: new Set(),
  });

  // Connect to WebSocket
  const connect = () => {
    if (socketRef.current || state.isConnecting) return;

    setState(prev => ({ ...prev, isConnecting: true, lastError: null }));

    try {
      const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      // Connection event handlers
      socket.on('connect', () => {
        console.log('WebSocket connected');
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          lastError: null,
          reconnectAttempts: 0,
        }));
        
        // Rejoin all previously subscribed rooms
        state.subscribedRooms.forEach(room => {
          socket.emit('join-room', room);
        });
      });

      socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
      });

      socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          lastError: error.message,
          reconnectAttempts: prev.reconnectAttempts + 1,
        }));
      });

      // Business logic event handlers
      socket.on('deployment:update', handleDeploymentUpdate);
      socket.on('deployment:progress', handleDeploymentProgress);
      socket.on('deployment:status', handleDeploymentStatus);
      socket.on('deployment:complete', handleDeploymentComplete);
      socket.on('deployment:log', handleLogStream);
      socket.on('service:status', handleServiceStatusUpdate);

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        lastError: error instanceof Error ? error.message : 'Failed to connect',
      }));
    }
  };

  // Disconnect from WebSocket
  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        subscribedRooms: new Set(),
      }));
    }
  };

  // Reconnect to WebSocket
  const reconnect = () => {
    disconnect();
    setTimeout(connect, 1000);
  };

  // Join a room
  const joinRoom = (room: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join-room', room);
      setState(prev => ({
        ...prev,
        subscribedRooms: new Set([...prev.subscribedRooms, room]),
      }));
    }
  };

  // Leave a room
  const leaveRoom = (room: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave-room', room);
    }
    setState(prev => {
      const newRooms = new Set(prev.subscribedRooms);
      newRooms.delete(room);
      return { ...prev, subscribedRooms: newRooms };
    });
  };

  // Leave all rooms
  const leaveAllRooms = () => {
    if (socketRef.current?.connected) {
      state.subscribedRooms.forEach(room => {
        socketRef.current!.emit('leave-room', room);
      });
    }
    setState(prev => ({
      ...prev,
      subscribedRooms: new Set(),
    }));
  };

  // Event handlers that use React Query cache invalidation
  const handleDeploymentUpdate = (data: DeploymentUpdateEvent) => {
    // Invalidate deployment queries to trigger refetch
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.getStatus.queryKey({ 
        input: { deploymentId: data.deploymentId } 
      })
    });
    
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.list.queryKey({ 
        input: { serviceId: '' } 
      })
    });

    // Show notification for important status changes
    if (data.status === 'success') {
      toast.success('Deployment Complete', {
        description: `Deployment ${data.deploymentId.slice(0, 8)} completed successfully`,
      });
    } else if (data.status === 'failed') {
      toast.error('Deployment Failed', {
        description: `Deployment ${data.deploymentId.slice(0, 8)} failed`,
      });
    }
  };

  const handleDeploymentProgress = (data: DeploymentUpdateEvent) => {
    // Invalidate deployment status to get latest progress
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.getStatus.queryKey({ 
        input: { deploymentId: data.deploymentId } 
      })
    });
  };

  const handleDeploymentStatus = (data: DeploymentUpdateEvent) => {
    // Invalidate deployment queries
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.getStatus.queryKey({ 
        input: { deploymentId: data.deploymentId } 
      })
    });
    
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.list.queryKey({ 
        input: { serviceId: '' } 
      })
    });
  };

  const handleDeploymentComplete = (data: DeploymentUpdateEvent) => {
    // Invalidate all deployment-related queries
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.getStatus.queryKey({ 
        input: { deploymentId: data.deploymentId } 
      })
    });
    
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.list.queryKey({ 
        input: { serviceId: '' } 
      })
    });

    // Show completion notification
    if (data.status === 'success') {
      toast.success('Deployment Completed Successfully');
    } else if (data.status === 'failed') {
      toast.error('Deployment Failed');
    }
  };

  const handleLogStream = (data: LogStreamEvent) => {
    // Invalidate deployment logs query to get latest logs
    queryClient.invalidateQueries({
      queryKey: orpc.deployment.getLogs.queryKey({ 
        input: { deploymentId: data.deploymentId } 
      })
    });
  };

  const handleServiceStatusUpdate = (data: ServiceStatusUpdateEvent) => {
    // Invalidate service queries
    queryClient.invalidateQueries({
      queryKey: orpc.service.getById.queryKey({ 
        input: { id: data.serviceId } 
      })
    });
    
    queryClient.invalidateQueries({
      queryKey: orpc.service.listByProject.queryKey({ 
        input: { projectId: '' } 
      })
    });

    toast.info('Service Status Updated', {
      description: `Service status changed to ${data.status}`,
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    // State
    ...state,
    
    // Actions
    connect,
    disconnect,
    reconnect,
    joinRoom,
    leaveRoom,
    leaveAllRooms,
  };
}

// Convenience hooks for specific use cases
export function useWebSocketConnection() {
  const { isConnected, isConnecting, lastError, reconnectAttempts } = useWebSocket();
  return { isConnected, isConnecting, lastError, reconnectAttempts };
}

export function useWebSocketActions() {
  const { connect, disconnect, reconnect, joinRoom, leaveRoom } = useWebSocket();
  return { connect, disconnect, reconnect, joinRoom, leaveRoom };
}

// Hook for deployment-specific WebSocket subscriptions
export function useDeploymentWebSocket(deploymentId?: string) {
  const webSocket = useWebSocket();
  
  useEffect(() => {
    if (deploymentId && webSocket.isConnected) {
      const room = `deployment:${deploymentId}`;
      webSocket.joinRoom(room);
      
      return () => {
        webSocket.leaveRoom(room);
      };
    }
  }, [deploymentId, webSocket.isConnected]);

  return webSocket;
}

// Hook for service-specific WebSocket subscriptions
export function useServiceWebSocket(serviceId?: string) {
  const webSocket = useWebSocket();
  
  useEffect(() => {
    if (serviceId && webSocket.isConnected) {
      const room = `service:${serviceId}`;
      webSocket.joinRoom(room);
      
      return () => {
        webSocket.leaveRoom(room);
      };
    }
  }, [serviceId, webSocket.isConnected]);

  return webSocket;
}

// Hook for project-specific WebSocket subscriptions
export function useProjectWebSocket(projectId?: string) {
  const webSocket = useWebSocket();
  
  useEffect(() => {
    if (projectId && webSocket.isConnected) {
      const room = `project:${projectId}`;
      webSocket.joinRoom(room);
      
      return () => {
        webSocket.leaveRoom(room);
      };
    }
  }, [projectId, webSocket.isConnected]);

  return webSocket;
}