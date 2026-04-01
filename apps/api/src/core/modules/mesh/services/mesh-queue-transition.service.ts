import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import * as z from "zod";
import {
    meshQueueTransitionApplyResultSchema,
    meshQueueTransitionAppendInputSchema,
    meshQueueTransitionAppendResultSchema,
    meshQueueTransitionLogEntrySchema,
    type MeshQueueTransitionAppendInput,
    type MeshQueueTransitionAppendResult,
    type MeshQueueTransitionLogEntry,
} from "@repo/contracts-entities";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { BaseMeshService } from "@/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";

const correlationInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    correlationId: z.uuid().optional(),
});

const requestPayloadSchema = z.object({
    entry: meshQueueTransitionLogEntrySchema,
});

const requestEnvelopeSchema = z.object({
    correlationId: z.uuid(),
    callerNodeId: z.uuid(),
    payload: requestPayloadSchema,
    emittedAt: z.string(),
});

const responseEnvelopeSchema = z.object({
    correlationId: z.uuid(),
    responderNodeId: z.uuid(),
    payload: meshQueueTransitionApplyResultSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

const cancelEnvelopeSchema = z.object({
    correlationId: z.uuid(),
    callerNodeId: z.uuid(),
    reason: z.enum(["caller_stop", "handler_stop"]),
    emittedAt: z.string(),
});

const queueTransitionMeshContracts = {
    applyTransitionRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema)
        .build(),
    applyTransitionResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema)
        .build(),
    applyTransitionCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
} as const;

@Injectable()
export class MeshQueueTransitionService
    extends BaseMeshService<typeof queueTransitionMeshContracts>
    implements OnModuleInit, OnModuleDestroy {
    private readonly serviceLogger = new Logger(MeshQueueTransitionService.name);

    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        super(meshTopicService, meshTopologyService, "queue-transition-internal", queueTransitionMeshContracts);
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();

        this.registerCallHandler(
            "applyTransitionRequest",
            "applyTransitionResponse",
            "applyTransitionCancel",
            { organizationId: null },
            async ({ payload }: {
                correlationId: string;
                callerNodeId: string;
                payload: { entry: MeshQueueTransitionLogEntry };
            }) => {
                const result = this.meshTopologyService.applyReplicatedQueueTransitionLogEntry({
                    entry: payload.entry,
                });

                return { payload: result };
            },
        );
    }

    onModuleDestroy(): void {
        this.teardownMeshNamespace();
    }

    async appendAndReplicate(input: MeshQueueTransitionAppendInput): Promise<MeshQueueTransitionAppendResult> {
        const parsedInput = meshQueueTransitionAppendInputSchema.parse(input);
        const local = this.meshTopologyService.appendQueueTransitionLog(parsedInput);

        if (!local.appended) {
            return local;
        }

        try {
            await this.callMany(
                "applyTransitionRequest",
                "applyTransitionResponse",
                "applyTransitionCancel",
                { entry: local.entry },
                {
                    organizationId: null,
                    timeoutMs: 1_500,
                },
            );
        } catch (error) {
            this.serviceLogger.warn(
                `Queue transition replication timeout for transition '${local.entry.payload.transitionId}': ${error instanceof Error ? error.message : "unknown error"}`,
            );
        }

        return meshQueueTransitionAppendResultSchema.parse(local);
    }

    async replicateEntry(entry: MeshQueueTransitionLogEntry): Promise<void> {
        const parsedEntry = meshQueueTransitionLogEntrySchema.parse(entry);

        await this.callMany(
            "applyTransitionRequest",
            "applyTransitionResponse",
            "applyTransitionCancel",
            { entry: parsedEntry },
            {
                organizationId: null,
                timeoutMs: 1_500,
            },
        );
    }
}
