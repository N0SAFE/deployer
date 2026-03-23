import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { SystemFleetRepository } from "../repositories/system-fleet.repository";

interface UpsertAllocationInput {
    actorUserId: string | null;
    organizationId: string;
    serverNodeId: string;
    allocationMode: "dedicated_full" | "dedicated_slice" | "shared_slice";
    cpuMillicores: number;
    memoryMb: number;
    maxServices: number | null;
    isEnabled: boolean;
};

interface CheckAdmissionInput {
    organizationId: string;
    requestedCpuMillicores: number;
    requestedMemoryMb: number;
    requestedServices: number;
    serverNodeId?: string;
};

interface CreateAdmissionRequestInput {
    organizationId: string;
    requesterUserId: string | null;
    requestedCpuMillicores: number;
    requestedMemoryMb: number;
    requestedServices: number;
    requestedServerNodeId?: string;
    requesterNote?: string | null;
};

interface ResolveAdmissionRequestInput {
    requestId: string;
    decision: "approved" | "rejected" | "cancelled";
    reviewerUserId: string | null;
    reviewerNote?: string | null;
    decisionServerNodeId?: string | null;
};

@Injectable()
export class SystemFleetService {
    constructor(private readonly fleetRepository: SystemFleetRepository) {}

    private async validateAllocationModel(input: UpsertAllocationInput) {
        if (input.isEnabled && (input.cpuMillicores <= 0 || input.memoryMb <= 0)) {
            throw new BadRequestException("Enabled allocations must provide CPU and memory greater than zero");
        }

        const [sameServerAllocations, serverNode] = await Promise.all([
            this.fleetRepository.listAllocations({ serverNodeId: input.serverNodeId }),
            this.fleetRepository.getServerNode(input.serverNodeId),
        ]);

        const enabledOnServer = sameServerAllocations.filter((allocation) => allocation.isEnabled);
        // exclude this org's own existing allocation (it will be replaced by the proposed values)
        const enabledForOtherOrgs = enabledOnServer.filter(
            (allocation) => allocation.organizationId !== input.organizationId,
        );

        if (input.allocationMode === "dedicated_full") {
            if (enabledForOtherOrgs.length > 0) {
                throw new ConflictException(
                    "dedicated_full requires exclusive server ownership; other organizations already have enabled allocations",
                );
            }
        } else {
            const conflictingDedicatedFull = enabledForOtherOrgs.find(
                (allocation) => allocation.allocationMode === "dedicated_full",
            );

            if (conflictingDedicatedFull) {
                throw new ConflictException(
                    "Cannot set dedicated_slice/shared_slice while another organization holds dedicated_full on this server",
                );
            }
        }

        if (!input.isEnabled) {
            // disabled allocations do not consume capacity
            return;
        }

        // aggregate capacity boundary check
        const othersEnabledCpu = enabledForOtherOrgs.reduce((sum, a) => sum + a.cpuMillicores, 0);
        const othersEnabledMem = enabledForOtherOrgs.reduce((sum, a) => sum + a.memoryMb, 0);
        const totalProposedCpu = othersEnabledCpu + input.cpuMillicores;
        const totalProposedMem = othersEnabledMem + input.memoryMb;

        if (serverNode?.maxCpuMillicores != null && totalProposedCpu > serverNode.maxCpuMillicores) {
            throw new BadRequestException(
                `Proposed allocation would exceed server CPU capacity: ${String(totalProposedCpu)}m requested but server maximum is ${String(serverNode.maxCpuMillicores)}m`,
            );
        }

        if (serverNode?.maxMemoryMb != null && totalProposedMem > serverNode.maxMemoryMb) {
            throw new BadRequestException(
                `Proposed allocation would exceed server memory capacity: ${String(totalProposedMem)}MB requested but server maximum is ${String(serverNode.maxMemoryMb)}MB`,
            );
        }
    }

    async listServers() {
        return this.fleetRepository.listServers();
    }

    async setServerCapacity(input: { serverNodeId: string; maxCpuMillicores: number | null; maxMemoryMb: number | null }) {
        const serverNode = await this.fleetRepository.getServerNode(input.serverNodeId);
        if (!serverNode) {
            throw new NotFoundException("Server node not found");
        }

        await this.fleetRepository.setServerCapacity(input);

        const servers = await this.fleetRepository.listServers();
        const updated = servers.find((s) => s.nodeId === input.serverNodeId);
        if (!updated) {
            throw new NotFoundException("Server node not found after capacity update");
        }

        return updated;
    }

    async listAllocations(input: { organizationId?: string; serverNodeId?: string }) {
        return this.fleetRepository.listAllocations(input);
    }

    async upsertAllocation(input: UpsertAllocationInput) {
        await this.validateAllocationModel(input);

        const allocation = await this.fleetRepository.upsertAllocation(input);
        if (!allocation) {
            throw new NotFoundException("Unable to upsert organization/server allocation");
        }

        return allocation;
    }

    async deleteAllocation(input: { organizationId: string; serverNodeId: string }) {
        return this.fleetRepository.deleteAllocation(input);
    }

    async checkAdmission(input: CheckAdmissionInput) {
        const allocations = await this.fleetRepository.listAllocations({
            organizationId: input.organizationId,
            serverNodeId: input.serverNodeId,
        });

        const enabledAllocations = allocations.filter((allocation) => allocation.isEnabled);

        if (enabledAllocations.length === 0) {
            return {
                organizationId: input.organizationId,
                allowed: false,
                reason: "No enabled allocation available for this organization/server scope",
                evaluatedAt: new Date(),
                candidates: [] as {
                    allocationId: string;
                    serverNodeId: string;
                    serverUrl: string | null;
                    allocationMode: "dedicated_full" | "dedicated_slice" | "shared_slice";
                    availableCpuMillicores: number;
                    availableMemoryMb: number;
                    maxServices: number | null;
                }[],
            };
        }

        const candidates = enabledAllocations.map((allocation) => ({
            allocationId: allocation.id,
            serverNodeId: allocation.serverNodeId,
            serverUrl: allocation.serverUrl,
            allocationMode: allocation.allocationMode,
            availableCpuMillicores: allocation.cpuMillicores,
            availableMemoryMb: allocation.memoryMb,
            maxServices: allocation.maxServices,
        }));

        const passing = candidates.filter((candidate) => {
            const cpuAllowed = input.requestedCpuMillicores <= candidate.availableCpuMillicores;
            const memoryAllowed = input.requestedMemoryMb <= candidate.availableMemoryMb;
            const servicesAllowed =
                candidate.maxServices === null ? true : input.requestedServices <= candidate.maxServices;

            return cpuAllowed && memoryAllowed && servicesAllowed;
        });

        return {
            organizationId: input.organizationId,
            allowed: passing.length > 0,
            reason:
                passing.length > 0
                    ? null
                    : "Requested resources exceed all enabled allocation quotas in scope",
            evaluatedAt: new Date(),
            candidates,
        };
    }

    async createAdmissionRequest(input: CreateAdmissionRequestInput) {
        const created = await this.fleetRepository.createAdmissionRequest(input);
        if (!created) {
            throw new NotFoundException("Unable to create admission request");
        }

        return created;
    }

    async listAdmissionRequests(input: {
        organizationId?: string;
        status?: "pending" | "approved" | "rejected" | "cancelled";
    }) {
        return this.fleetRepository.listAdmissionRequests(input);
    }

    async resolveAdmissionRequest(input: ResolveAdmissionRequestInput) {
        const resolved = await this.fleetRepository.resolveAdmissionRequest(input);
        if (!resolved) {
            throw new NotFoundException("Admission request not found");
        }

        return resolved;
    }
}
