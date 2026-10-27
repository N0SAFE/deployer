import z from "zod/v4";
import { standard } from "@deployer/orpc-utils";
import { projectEnvironmentSchema } from "@deployer/contracts-entities";

export const projectIdParamSchema = z.object({ id: z.uuid() });

export const projectEnvironmentParamsSchema = z.object({
    id: z.uuid(),
    environmentId: z.uuid(),
});

export const projectEnvironmentOps = standard.zod(projectEnvironmentSchema, "projectEnvironment");
