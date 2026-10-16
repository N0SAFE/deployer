import { Injectable } from "@nestjs/common";
import * as z from "zod";
import { projectRoleSchema } from "@deployer/contracts-entities";
import { BasePooledEventService } from "@deployer/nest-events";
import { contractBuilder } from "@deployer/nest-events";
import { CoreEventStreamPoolService } from "@deployer/nest-events";

export const projectEventContracts = {
    projectCreated: contractBuilder()
        .input(z.object({ ownerId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                ownerId: z.string(),
                name: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    projectUpdated: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                ownerId: z.string(),
                changedFields: z.array(z.string()),
                timestamp: z.string(),
            }),
        )
        .build(),

    projectDeleted: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                ownerId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    projectCollaboratorInvited: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                userId: z.string(),
                // The canonical vocabulary from the contract, not a re-typed
                // literal: this enum had listed `admin`/`developer`, which the
                // permission builder does not define, while the stored role is
                // `maintainer`/`deployer` — so the emitted event failed its own
                // schema on every invite.
                role: projectRoleSchema,
                timestamp: z.string(),
            }),
        )
        .build(),

    projectCollaboratorRemoved: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                userId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    projectEnvironmentCreated: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                environmentId: z.string(),
                environmentName: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    projectEnvironmentDeleted: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                projectId: z.string(),
                environmentId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),
} as const;

export type ProjectEventContracts = typeof projectEventContracts;

@Injectable()
export class ProjectEventService extends BasePooledEventService<ProjectEventContracts, "project"> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("project", projectEventContracts, streamPool);
    }
}
