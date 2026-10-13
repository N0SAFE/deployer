import z from "zod/v4";
import { contractBuilder } from "@deployer/nest-events";
import { meshRuntimeEventSchema, meshTopologyEventSchema } from "@deployer/contracts-entities";

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