/**
 * Orchestration Adapter Service
 * 
 * PURPOSE: Transform internal orchestration types to contract types
 * 
 * RESPONSIBILITIES:
 * - StackStatus → Contract StackStatus transformations
 * - Handle status enum mapping between internal and contract
 * - Ensure required fields are present
 * 
 * PATTERN: Service-Adapter Pattern
 * - Receives data as parameters
 * - Returns contract types
 * - Zero business logic
 * - Zero database calls
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { StackStatus } from '@/core/modules/orchestration/types/deployment-job.types';
import type { z } from 'zod';
import type { StackStatusSchema, SuccessWithDataResponseSchema } from '@repo/api-contracts/modules/orchestration';

// Contract output types inferred from schemas
type ContractStackStatus = z.infer<typeof StackStatusSchema>;
type GetStackResponse = z.infer<ReturnType<typeof SuccessWithDataResponseSchema<typeof StackStatusSchema>>>;
type ListStacksResponse = z.infer<ReturnType<typeof SuccessWithDataResponseSchema<z.ZodArray<typeof StackStatusSchema>>>>;

@Injectable()
export class OrchestrationAdapter {
    /**
     * Map internal status to contract status enum
     */
    private mapStatusToContract(
        status: StackStatus['status']
    ): ContractStackStatus['status'] {
        switch (status) {
            case 'pending':
                return 'pending';
            case 'deploying':
            case 'updating':
            case 'removing':
                return 'deploying';
            case 'running':
                return 'running';
            case 'failed':
            case 'error':
                return 'error';
            case 'stopped':
                return 'stopped';
            default:
                return 'pending';
        }
    }

    /**
     * Transform internal StackStatus to contract format
     */
    adaptStackStatusToContract(status: StackStatus): ContractStackStatus {
        return {
            id: status.id,
            name: status.name,
            projectId: status.projectId ?? '',
            environment: status.environment ?? '',
            status: this.mapStatusToContract(status.status),
            services: status.services.map(service => ({
                name: service.name,
                replicas: {
                    desired: service.replicas.desired,
                    current: service.replicas.current,
                    updated: service.replicas.updated,
                },
                status: service.status,
                ports: service.ports,
                endpoints: service.endpoints,
            })),
            createdAt: status.createdAt,
            updatedAt: status.updatedAt,
            resourceUsage: status.resourceUsage,
        };
    }

    /**
     * Adapt getStack response to contract format
     */
    adaptGetStackToContract(status: StackStatus | null): GetStackResponse {
        if (!status) {
            throw new NotFoundException('Stack not found');
        }
        return {
            success: true as const,
            data: this.adaptStackStatusToContract(status),
        };
    }

    /**
     * Adapt listStacks response to contract format
     */
    adaptListStacksToContract(stacks: StackStatus[]): ListStacksResponse {
        return {
            success: true as const,
            data: stacks.map(stack => this.adaptStackStatusToContract(stack)),
        };
    }
}
