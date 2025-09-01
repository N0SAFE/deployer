'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { orpc } from '@/lib/orpc';
import { toast } from 'sonner';
// WebSocket event interfaces

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

// Server-sent WebSocket event payloads (from NestJS gateway)
type DeploymentGatewayEventType =
  | 'deployment_started'
  | 'deployment_completed'
  | 'deployment_failed'
  | 'deployment_cancelled';

export interface DeploymentGatewayEvent {
  deploymentId: string;
  type: DeploymentGatewayEventType;
}

export interface DeploymentProgressGatewayEvent {
  deploymentId: string;
  progress: number;
  stage?: string;
}

export interface LogMessageGatewayEvent {
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
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      // Connect to the deployments namespace exposed by the API gateway
      const socket = io(`${base}/deployments`, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      // Connection established
      socket.on('connect', () => {
        console.log('WebSocket connected');
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          lastError: null,
          reconnectAttempts: 0,
        }));

        // Re-subscribe to all rooms after reconnect
        state.subscribedRooms.forEach(room => {
          const [scope, id] = room.split(':');
          if (scope === 'deployment') {
            socket.emit('subscribe_to_deployment', { deploymentId: id });
          } else if (scope === 'service') {
            socket.emit('subscribe_to_service', { serviceId: id });
          } else if (scope === 'project') {
            socket.emit('subscribe_to_project', { projectId: id });
          }
        });
      });

      socket.on('disconnect', (reason: string) => {
        console.log('WebSocket disconnected:', reason);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
      });

      socket.on('connect_error', (error: Error) => {
        console.error('WebSocket connection error:', error);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          lastError: error.message,
          reconnectAttempts: prev.reconnectAttempts + 1,
        }));
      });

      // Business logic event handlers mapping to server events
      socket.on('deployment_event', (event: DeploymentGatewayEvent) => {
        const mapped: DeploymentUpdateEvent = {
          deploymentId: event.deploymentId,
          status:
            event.type === 'deployment_completed'
              ? 'success'
              : event.type === 'deployment_failed'
              ? 'failed'
              : event.type === 'deployment_cancelled'
              ? 'cancelled'
              : 'queued',
        };
        handleDeploymentStatus(mapped);
        if (mapped.status === 'success' || mapped.status === 'failed') {
          handleDeploymentComplete(mapped);
        }
      });
      socket.on('deployment_progress', (event: DeploymentProgressGatewayEvent) => {
        const mapped: DeploymentUpdateEvent = {
          deploymentId: event.deploymentId,
          progress: event.progress,
          stage: event.stage,
        };
        handleDeploymentProgress(mapped);
      });
      socket.on('log_message', (event: LogMessageGatewayEvent) => {
        const mapped: LogStreamEvent = { ...event };
        handleLogStream(mapped);
      });

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
      const [scope, id] = room.split(':');
      if (scope === 'deployment') {
        socketRef.current.emit('subscribe_to_deployment', { deploymentId: id });
      } else if (scope === 'service') {
        socketRef.current.emit('subscribe_to_service', { serviceId: id });
      } else if (scope === 'project') {
        socketRef.current.emit('subscribe_to_project', { projectId: id });
      }
      setState(prev => ({
        ...prev,
        subscribedRooms: new Set([...prev.subscribedRooms, room]),
      }));
    }
  };

  // Leave a room
  const leaveRoom = (room: string) => {
    if (socketRef.current?.connected) {
      const [scope, id] = room.split(':');
      socketRef.current.emit('unsubscribe', { type: scope, id });
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
        const [scope, id] = room.split(':');
        socketRef.current!.emit('unsubscribe', { type: scope, id });
      });
    }
    setState(prev => ({
      ...prev,
      subscribedRooms: new Set(),
    }));
  };

  // Event handlers that use React Query cache invalidation
  // Note: unified handling happens in handleDeploymentStatus/progress/complete

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

  // Service status updates are not currently emitted by the gateway

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