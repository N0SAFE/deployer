import { route } from "@repo/orpc-utils/builder";
import {
    templateVersionMigrationApplyInputSchema,
    templateVersionMigrationApplyResultSchema,
    templateVersionMigrationListInputSchema,
    templateVersionMigrationListResultSchema,
    templateVersionMigrationPreviewInputSchema,
    templateVersionMigrationPreviewResultSchema,
} from "@repo/api-contracts/common/template";

export const templateListVersionMigrationsContract = route({
    method: "GET",
    path: "/version-migrations",
    summary: "List available template version transforms",
})
    .input(templateVersionMigrationListInputSchema)
    .output(templateVersionMigrationListResultSchema)
    .build();

export const templatePreviewVersionMigrationContract = route({
    method: "POST",
    path: "/version-migrations/preview",
    summary: "Preview a template version migration with safety checks",
})
    .input((b) => b.body(templateVersionMigrationPreviewInputSchema))
    .output(templateVersionMigrationPreviewResultSchema)
    .build();

export const templateApplyVersionMigrationContract = route({
    method: "POST",
    path: "/version-migrations/apply",
    summary: "Apply a template version migration (or execute dry-run)",
})
    .input((b) => b.body(templateVersionMigrationApplyInputSchema))
    .output(templateVersionMigrationApplyResultSchema)
    .build();
