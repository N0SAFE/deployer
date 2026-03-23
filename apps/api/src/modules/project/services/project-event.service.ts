import { Injectable } from "@nestjs/common";
import * as z from "zod";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";

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
                role: z.enum(["owner", "admin", "developer", "viewer"]),
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
export class ProjectEventService extends BaseEventService<ProjectEventContracts, "project"> {
    constructor() {
        super("project", projectEventContracts);
    }
}
