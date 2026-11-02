import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { templateGetCompatibilityMatrixContract, templateValidateCompatibilityContract } from "./compatibility";
import { templateCreateContract } from "./create";
import { templateDeleteContract } from "./delete";
import { templateFindByIdContract } from "./findById";
import { templateListContract } from "./list";
import {
    templateApplyVersionMigrationContract,
    templateListVersionMigrationsContract,
    templatePreviewVersionMigrationContract,
} from "./migration";
import { templateResolveContract, templateResolveSetContract } from "./resolver";
import { templateUpdateContract } from "./update";
import {
    templateValidateContract,
    templateValidateSemanticContract,
    templateValidateSetContract,
    templateValidateStructuralContract,
} from "./validation";

export const templateContract = oc.meta(openapi({ tags: ["Template"], prefix: "/templates" })).router({
    list: templateListContract,
    findById: templateFindByIdContract,
    create: templateCreateContract,
    update: templateUpdateContract,
    delete: templateDeleteContract,
    getCompatibilityMatrix: templateGetCompatibilityMatrixContract,
    validateCompatibility: templateValidateCompatibilityContract,
    validate: templateValidateContract,
    validateStructural: templateValidateStructuralContract,
    validateSemantic: templateValidateSemanticContract,
    validateSet: templateValidateSetContract,
    resolve: templateResolveContract,
    resolveSet: templateResolveSetContract,
    listVersionMigrations: templateListVersionMigrationsContract,
    previewVersionMigration: templatePreviewVersionMigrationContract,
    applyVersionMigration: templateApplyVersionMigrationContract,
});

export type TemplateContract = typeof templateContract;

export * from "./list";
export * from "./findById";
export * from "./create";
export * from "./update";
export * from "./delete";
export * from "./compatibility";
export * from "./validation";
export * from "./resolver";
export * from "./migration";
