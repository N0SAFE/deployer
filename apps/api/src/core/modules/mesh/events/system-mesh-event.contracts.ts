import z from "zod/v4";
import { contractBuilder } from "@repo/nest-events";
import { meshRuntimeEventSchema, meshTopologyEventSchema } from "@repo/contracts-entities";

export const systemMeshEventContracts = {
    runtime: contractBuilder()
        .input(z.object({}))
        .output(meshRuntimeEventSchema)
        .build(),
    topology: contractBuilder()
        .input(z.object({}))
        .output(meshTopologyEventSchema)
        .build(),
} as const;

export type SystemMeshEventContracts = typeof systemMeshEventContracts;