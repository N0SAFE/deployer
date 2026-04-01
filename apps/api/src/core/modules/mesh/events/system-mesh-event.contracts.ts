import z from "zod/v4";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { meshRuntimeEventSchema, meshTopologyEventSchema } from "@repo/contracts-entities";

export const systemMeshEventContracts = {
    runtime: contractBuilder()
        .input(
            z.object({
                clusterId: z.uuid(),
            }),
        )
        .output(meshRuntimeEventSchema)
        .build(),
    topology: contractBuilder()
        .input(
            z.object({
                clusterId: z.uuid(),
            }),
        )
        .output(meshTopologyEventSchema)
        .build(),
} as const;

export type SystemMeshEventContracts = typeof systemMeshEventContracts;