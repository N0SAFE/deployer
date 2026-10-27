import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import {
    getAllProvidersContract,
    getProviderSchemaContract,
    getCompatibleBuildersContract,
    getAllBuildersContract,
    getBuilderSchemaContract,
    getCompatibleProvidersContract,
    validateProviderConfigContract,
    validateBuilderConfigContract,
} from "./contracts";

export const providerSchemaContract = oc.meta(openapi({ tags: ["Provider Schema"] })).router({
    getAllProviders: getAllProvidersContract,
    getProviderSchema: getProviderSchemaContract,
    getCompatibleBuilders: getCompatibleBuildersContract,
    getAllBuilders: getAllBuildersContract,
    getBuilderSchema: getBuilderSchemaContract,
    getCompatibleProviders: getCompatibleProvidersContract,
    validateProviderConfig: validateProviderConfigContract,
    validateBuilderConfig: validateBuilderConfigContract,
});

export type ProviderSchemaContract = typeof providerSchemaContract;

export * from "./schemas";
export * from "./contracts";
