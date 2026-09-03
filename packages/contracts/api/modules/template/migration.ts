import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    templateVersionMigrationApplyInputSchema,
    templateVersionMigrationApplyResultSchema,
    templateVersionMigrationListInputSchema,
    templateVersionMigrationListResultSchema,
    templateVersionMigrationPreviewInputSchema,
    templateVersionMigrationPreviewResultSchema,
} from "@repo/contracts-entities";

const templateVersionMigrationListOps = standard.zod(
    templateVersionMigrationListResultSchema,
    "templateVersionMigrationList",
);
const templateVersionMigrationPreviewOps = standard.zod(
    templateVersionMigrationPreviewResultSchema,
    "templateVersionMigrationPreview",
);
const templateVersionMigrationApplyOps = standard.zod(
    templateVersionMigrationApplyResultSchema,
    "templateVersionMigrationApply",
);

export const templateListVersionMigrationsContract = templateVersionMigrationListOps
    .list()
    .path("/version-migrations")
    .input((b) => b.query(templateVersionMigrationListInputSchema))
    .output(templateVersionMigrationListResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templatePreviewVersionMigrationContract = templateVersionMigrationPreviewOps
    .create()
    .path("/version-migrations/preview")
    .input((b) => b.body(templateVersionMigrationPreviewInputSchema))
    .output(templateVersionMigrationPreviewResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templateApplyVersionMigrationContract = templateVersionMigrationApplyOps
    .create()
    .path("/version-migrations/apply")
    .input((b) => b.body(templateVersionMigrationApplyInputSchema))
    .output(templateVersionMigrationApplyResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
