'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { 
  deploymentStatusSchema
} from '@repo/api-contracts';

// Type inference from ORPC contracts
type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

// Hook to get deployments for a service
export function useServiceDeployments(serviceId: string) {
  return useQuery(orpc.service.getDeployments.queryOptions({
    input: {
      id: serviceId,
      limit: 50
    },
    enabled: !!serviceId,
    staleTime: 1000 * 30, // 30 seconds
  }));
}

// Hook to get all deployments (using deployment.list endpoint)
export function useDeployments(options?: {
  serviceId?: string;
  limit?: number;
  offset?: number;
  status?: DeploymentStatus;
}) {
  const params = {
    serviceId: options?.serviceId || '',
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.status && { status: options.status })
  };

  return useQuery(orpc.deployment.list.queryOptions({
    input: params,
    staleTime: 1000 * 30, // 30 seconds
  }));
}

// Hook to get deployment status
export function useDeploymentStatus(deploymentId: string) {
  return useQuery(orpc.deployment.getStatus.queryOptions({
    input: {
      deploymentId
    },
    enabled: !!deploymentId,
    refetchInterval: 5000, // Poll every 5 seconds for active deployments
    staleTime: 0, // Always fresh for real-time status
  }));
}

// Hook to get deployment logs
export function useDeploymentLogs(deploymentId: string, options?: {
  limit?: number;
  offset?: number;
}) {
  return useQuery(orpc.deployment.getLogs.queryOptions({
    input: {
      deploymentId,
      limit: options?.limit || 100,
      offset: options?.offset || 0
    },
    enabled: !!deploymentId,
    staleTime: 1000 * 10, // 10 seconds
    // Ensure AbortController signal is properly handled
    retry: (failureCount, error) => {
      // Don't retry on abort errors
      if (error?.name === 'AbortError' || (error && typeof error === 'object' && 'code' in error && error.code === 'ABORT_ERR')) {
        return false;
      }
      return failureCount < 3;
    },
  }));
}

// Hook to trigger a new deployment
export function useCreateDeployment() {
  const queryClient = useQueryClient();

  return useMutation(orpc.deployment.trigger.mutationOptions({
    onSuccess: (data, variables) => {
      toast.success('Deployment triggered successfully');
      
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: orpc.deployment.list.queryKey({ input: { serviceId: variables.serviceId } })
      });
      queryClient.invalidateQueries({
        queryKey: orpc.service.getDeployments.queryKey({ input: { id: variables.serviceId } })
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger deployment: ${error.message || 'Unknown error'}`);
    },
  }));
}

// Hook to cancel a deployment
export function useCancelDeployment() {
  const queryClient = useQueryClient();

  return useMutation(orpc.deployment.cancel.mutationOptions({
    onSuccess: (data, variables) => {
      toast.success('Deployment cancelled successfully');
      
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: orpc.deployment.getStatus.queryKey({ input: { deploymentId: variables.deploymentId } })
      });
      queryClient.invalidateQueries({
        queryKey: orpc.deployment.list.queryKey({ input: { serviceId: '' } })
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to cancel deployment: ${error.message || 'Unknown error'}`);
    },
  }));
}

// Hook to rollback a deployment
export function useRollbackDeployment() {
  const queryClient = useQueryClient();

  return useMutation(orpc.deployment.rollback.mutationOptions({
    onSuccess: () => {
      toast.success('Rollback initiated successfully');
      
      // Invalidate deployment queries
      queryClient.invalidateQueries({
        queryKey: orpc.deployment.list.queryKey({ input: { serviceId: '' } })
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to initiate rollback: ${error.message || 'Unknown error'}`);
    },
  }));
}

// Utility hook for deployment actions
export function useDeploymentActions() {
  const triggerDeployment = useCreateDeployment();
  const cancelDeployment = useCancelDeployment();
  const rollbackDeployment = useRollbackDeployment();

  return {
    triggerDeployment: triggerDeployment.mutate,
    cancelDeployment: cancelDeployment.mutate,
    rollbackDeployment: rollbackDeployment.mutate,
    isLoading: {
      trigger: triggerDeployment.isPending,
      cancel: cancelDeployment.isPending,
      rollback: rollbackDeployment.isPending,
    }
  };
}

// Helper hook for deployment status polling
export function useDeploymentPolling(deploymentId: string) {
  const { data: status, isLoading } = useDeploymentStatus(deploymentId);
  
  const isActive = status?.status && !['success', 'failed', 'cancelled'].includes(status.status);
  
  return {
    status: status?.status,
    stage: status?.stage,
    progress: status?.progress,
    isActive,
    isLoading
  };
}