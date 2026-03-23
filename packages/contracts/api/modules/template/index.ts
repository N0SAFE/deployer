import { oc } from "@orpc/contract";
import { templateListContract } from "./list";
import { templateFindByIdContract } from "./findById";
import { templateCreateContract } from "./create";
import { templateUpdateContract } from "./update";
import { templateDeleteContract } from "./delete";
import { templateGetCompatibilityMatrixContract, templateValidateCompatibilityContract } from "./compatibility";
import {
    templateValidateContract,
    templateValidateSemanticContract,
    templateValidateSetContract,
    templateValidateStructuralContract,
} from "./validation";
import { templateResolveContract, templateResolveSetContract } from "./resolver";
import {
    templateApplyVersionMigrationContract,
    templateListVersionMigrationsContract,
    templatePreviewVersionMigrationContract,
} from "./migration";

export const templateContract = oc.tag("Template").prefix("/templates").router({
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
